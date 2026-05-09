import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "../net/socket.js";
import {
  activeGrid,
  buildDisplaySnap,
  getMyPlayer,
  type ClientGameState,
} from "../game/state.js";
import { Renderer } from "../game/renderer.js";
import { InputController } from "../game/input.js";
import { VoiceMesh } from "../net/voice.js";
import { ITEMS, RENDER_FPS_CAP, Scene, SNAPSHOT_RENDER_DELAY_MS, TileType } from "@quota/shared";
import type { ScrapInstance } from "@quota/shared";
import { Hud } from "./Hud.js";
import { Chat } from "./Chat.js";
import { Terminal } from "./Terminal.js";
import { LandingCutscene } from "./LandingCutscene.js";
import { ScanOverlay, type ScanResult } from "./ScanOverlay.js";

const SCAN_DURATION_MS = 4000;

export function GameView({
  socket,
  stateRef,
  forceRender,
}: {
  socket: Socket;
  stateRef: React.MutableRefObject<ClientGameState>;
  forceRender: React.Dispatch<React.SetStateAction<number>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef(new InputController());
  const rendererRef = useRef<Renderer | null>(null);
  const voiceRef = useRef<VoiceMesh | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[] | null>(null);
  const seqRef = useRef(0);
  const flashlightRef = useRef(false);

  // Voice mesh
  useEffect(() => {
    const v = new VoiceMesh((m) => socket.send(m));
    voiceRef.current = v;
    if (stateRef.current.myId) v.setMyId(stateRef.current.myId);
    const off = socket.on(async (msg) => {
      if (msg.t === "welcome") v.setMyId(msg.playerId);
      if (msg.t === "signal") await v.handleSignal(msg.fromPlayerId, msg.payload);
      if (msg.t === "lobby_update") {
        const me = stateRef.current.myId;
        if (!me) return;
        for (const p of msg.players) if (p.id !== me) await v.ensurePeer(p.id, me < p.id);
      }
      if (msg.t === "lobby_left") v.dispose();
    });
    return () => {
      off();
      v.dispose();
      voiceRef.current = null;
    };
  }, [socket, stateRef]);

  // Init renderer + input
  useEffect(() => {
    const c = canvasRef.current!;
    const renderer = new Renderer(c);
    rendererRef.current = renderer;
    renderer.resize(c);
    inputRef.current.attach(c, () => chatOpen);
    const onResize = () => renderer.resize(c);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      inputRef.current.detach();
    };
  }, [chatOpen]);

  // Server-triggered terminal open (player pressed E on the ship console)
  useEffect(() => {
    const off = socket.on((msg) => {
      if (msg.t === "open_terminal") {
        stateRef.current.shouldOpenTerminal = false;
        setTerminalOpen(true);
      }
    });
    return off;
  }, [socket, stateRef]);

  // Game loop with 60fps cap, snapshot interpolation, reliable net edges
  useEffect(() => {
    let raf = 0;
    const frameInterval = 1000 / RENDER_FPS_CAP;
    let lastFrame = performance.now();
    let lastInputSentAt = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const elapsed = now - lastFrame;
      if (elapsed < frameInterval - 0.5) return;
      lastFrame = now - (elapsed % frameInterval);

      const c = canvasRef.current!;
      const renderer = rendererRef.current!;
      const input = inputRef.current;
      const state = stateRef.current;

      // 1. UI edges every frame
      const ui = input.consumeUiEdges();
      if (ui.chatToggle) {
        setChatOpen((v) => !v);
        input.forceRefocus();
      }
      if (ui.terminalToggle) setTerminalOpen((v) => !v);
      if (ui.flashlightToggle) flashlightRef.current = !flashlightRef.current;
      if (ui.voicePressed) voiceRef.current?.setActive(true);
      if (ui.voiceReleased) voiceRef.current?.setActive(false);
      if (ui.scan) runScan(state, setScanResults);

      // 2. Build display snapshot
      const renderTime = Date.now() - SNAPSHOT_RENDER_DELAY_MS;
      state.displaySnap = buildDisplaySnap(state, renderTime);

      // 3. Render
      const facing = renderer.computeFacing(c, { x: input.state.mouseX, y: input.state.mouseY });
      renderer.draw(state, facing);

      // 4. Send input
      if (now - lastInputSentAt >= 1000 / 30) {
        lastInputSentAt = now;
        const net = input.consumeNetEdges();
        seqRef.current++;
        socket.send({
          t: "input",
          seq: seqRef.current,
          mv: { x: input.state.mvx, y: input.state.mvy },
          facing,
          flashlight: flashlightRef.current,
          interact: net.interact,
          drop: net.drop,
          selectedSlot: input.state.selectedSlot,
        });
      }

      // 5. Voice proximity
      const me = getMyPlayer(state);
      const grid = activeGrid(state);
      if (state.displaySnap && voiceRef.current && me) {
        voiceRef.current.updateProximity(state.displaySnap, grid, me.pos, me.scene);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [socket, stateRef]);

  // Heartbeat
  useEffect(() => {
    const id = window.setInterval(() => socket.send({ t: "ping", ts: Date.now() }), 4000);
    return () => clearInterval(id);
  }, [socket]);

  // Re-render React on any server message
  useEffect(() => {
    const off = socket.on(() => forceRender((n) => n + 1));
    return off;
  }, [socket, forceRender]);

  const me = getMyPlayer(stateRef.current);
  const onShip = me?.scene === Scene.Ship;
  const showTerminal = terminalOpen && onShip;

  // Hint when standing on or next to interactable tiles
  const tileHint = useMemo(() => {
    if (!me || !stateRef.current.grid) return null;
    const g = stateRef.current.grid;
    const tx = Math.floor(me.pos.x);
    const ty = Math.floor(me.pos.y);
    const here = g.tiles[ty * g.w + tx];
    if (here === TileType.ShipDoor) return me.scene === Scene.Ship ? "Step out to the surface" : "Step inside the ship";
    if (here === TileType.FacilityEntrance) return me.scene === Scene.Surface ? "Step into the facility" : "Step back to the surface";
    if (here === TileType.CompanyDoor) return me.scene === Scene.Surface ? "Step inside the company building" : "Step back outside";
    // Adjacent interactables
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = g.tiles[(ty + dy) * g.w + (tx + dx)];
        if (t === TileType.ShipConsole && me.scene === Scene.Ship) return "Press E to open ship terminal";
        if (t === TileType.CompanyDesk && me.scene === Scene.Company) return "Press E to SELL all stowed scrap";
      }
    }
    return null;
  }, [me?.pos.x, me?.pos.y, me?.scene, stateRef.current.grid]);

  const cutsceneActive = Date.now() < stateRef.current.cutsceneEndsAt;

  return (
    <>
      <canvas className="game-canvas" ref={canvasRef} />
      <Hud state={stateRef.current} />
      <Chat
        socket={socket}
        state={stateRef.current}
        open={chatOpen}
        setOpen={setChatOpen}
        onShip={onShip}
      />
      {showTerminal && (
        <Terminal
          state={stateRef.current}
          onClose={() => setTerminalOpen(false)}
          onBuy={(itemId, qty) => socket.send({ t: "buy", itemId, qty })}
          onSelectMoon={(moonId) => socket.send({ t: "select_moon", moonId })}
          onLaunch={() => {
            socket.send({ t: "launch" });
            setTerminalOpen(false);
          }}
        />
      )}
      {tileHint && !cutsceneActive && <div className="toast">{tileHint}</div>}
      {stateRef.current.toast && Date.now() < stateRef.current.toastUntil && (
        <div className="toast" style={{ top: 110 }}>
          {stateRef.current.toast}
        </div>
      )}
      {!me?.alive && stateRef.current.displaySnap && !cutsceneActive && (
        <div className="kill-screen">
          <h1>YOU DIED</h1>
          <p>Wait for the ship to leave orbit.</p>
        </div>
      )}
      {cutsceneActive && (
        <LandingCutscene
          moonName={stateRef.current.cutsceneMoonName ?? ""}
          endsAt={stateRef.current.cutsceneEndsAt}
        />
      )}
      {scanResults && <ScanOverlay results={scanResults} onDone={() => setScanResults(null)} />}
      <div className="help-overlay">
        <div><b>WASD</b> move &middot; <b>mouse</b> aim &middot; <b>E</b> interact &middot; <b>G</b> drop</div>
        <div><b>F</b> flashlight &middot; <b>RMB</b> scan &middot; <b>Tab</b> terminal &middot; <b>Enter</b> chat</div>
        <div><b>V</b> voice &middot; <b>1&ndash;4</b> hotbar</div>
      </div>
    </>
  );
}

/** Build the scan list from the latest displaySnap: all visible scrap + items. */
function runScan(
  state: ClientGameState,
  setResults: React.Dispatch<React.SetStateAction<ScanResult[] | null>>,
): void {
  const snap = state.displaySnap;
  const me = getMyPlayer(state);
  if (!snap || !me) return;
  const results: ScanResult[] = [];
  // Scrap with sell value
  for (const s of snap.scrap as ScrapInstance[]) {
    if (s.carriedBy) continue;
    const def = ITEMS[s.itemId];
    const dx = s.pos.x - me.pos.x;
    const dy = s.pos.y - me.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 14) continue;
    if (!inSightCone(me.facing, dx, dy, dist)) continue;
    results.push({
      id: s.id,
      name: def?.name ?? s.itemId,
      value: s.value,
      worldPos: s.pos,
    });
  }
  // Tools (no sell value)
  for (const it of snap.items) {
    if (it.carriedBy) continue;
    const def = ITEMS[it.itemId];
    const dx = it.pos.x - me.pos.x;
    const dy = it.pos.y - me.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 14) continue;
    if (!inSightCone(me.facing, dx, dy, dist)) continue;
    results.push({
      id: it.id,
      name: def?.name ?? it.itemId,
      value: 0,
      worldPos: it.pos,
    });
  }
  if (results.length > 0) {
    setResults(results);
    window.setTimeout(() => setResults(null), SCAN_DURATION_MS);
  } else {
    setResults([{ id: -1, name: "(nothing in view)", value: 0, worldPos: me.pos }]);
    window.setTimeout(() => setResults(null), 1500);
  }
}

function inSightCone(facing: number, dx: number, dy: number, dist: number): boolean {
  if (dist <= 1.4) return true;
  const ang = Math.atan2(dy, dx);
  let diff = ang - facing;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) <= Math.PI / 2; // 180° cone for scan (more generous than visual cone)
}
