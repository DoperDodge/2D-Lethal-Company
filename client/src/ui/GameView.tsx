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
import { RENDER_FPS_CAP, Scene, SNAPSHOT_RENDER_DELAY_MS, TileType } from "@quota/shared";
import { Hud } from "./Hud.js";
import { Chat } from "./Chat.js";
import { Terminal } from "./Terminal.js";
import { LandingCutscene } from "./LandingCutscene.js";

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
  const seqRef = useRef(0);
  // Track flashlight state locally (toggled by client, sent on each input)
  const flashlightRef = useRef(false);

  // Voice mesh: subscribe to signals, keep peers fresh as roster changes
  useEffect(() => {
    const v = new VoiceMesh((m) => socket.send(m));
    voiceRef.current = v;
    if (stateRef.current.myId) v.setMyId(stateRef.current.myId);
    const off = socket.on(async (msg) => {
      if (msg.t === "welcome") v.setMyId(msg.playerId);
      if (msg.t === "signal") {
        await v.handleSignal(msg.fromPlayerId, msg.payload);
      }
      if (msg.t === "lobby_update") {
        const me = stateRef.current.myId;
        if (!me) return;
        for (const p of msg.players) {
          if (p.id !== me) await v.ensurePeer(p.id, me < p.id);
        }
      }
      if (msg.t === "lobby_left") {
        v.dispose();
      }
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

  // Game loop with 60fps cap, snapshot interpolation, and reliable net-edge transmit
  useEffect(() => {
    let raf = 0;
    const frameInterval = 1000 / RENDER_FPS_CAP;
    let lastFrame = performance.now();
    let lastInputSentAt = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const elapsed = now - lastFrame;
      // Hard 60fps cap — if we haven't waited the frame interval yet, skip
      if (elapsed < frameInterval - 0.5) return;
      lastFrame = now - (elapsed % frameInterval);

      const c = canvasRef.current!;
      const renderer = rendererRef.current!;
      const input = inputRef.current;
      const state = stateRef.current;

      // 1. Drain UI edges every frame (toggles, holds)
      const ui = input.consumeUiEdges();
      if (ui.chatToggle) {
        setChatOpen((v) => !v);
        input.forceRefocus();
      }
      if (ui.terminalToggle) {
        setTerminalOpen((v) => !v);
      }
      if (ui.flashlightToggle) {
        flashlightRef.current = !flashlightRef.current;
      }
      if (ui.voicePressed) voiceRef.current?.setActive(true);
      if (ui.voiceReleased) voiceRef.current?.setActive(false);

      // 2. Build display snapshot via interpolation
      const renderTime = Date.now() - SNAPSHOT_RENDER_DELAY_MS;
      state.displaySnap = buildDisplaySnap(state, renderTime);

      // 3. Render
      const facing = renderer.computeFacing(c, { x: input.state.mouseX, y: input.state.mouseY });
      renderer.draw(state, facing);

      // 4. Send input — drain net edges only at send-time so they're never lost.
      //    Sending @ ~30Hz is plenty for movement; net edges are accumulated since the last send.
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

      // 5. Update voice proximity from latest snapshot
      const me = getMyPlayer(state);
      const grid = activeGrid(state);
      if (state.displaySnap && voiceRef.current && me) {
        voiceRef.current.updateProximity(state.displaySnap, grid, me.pos, me.scene);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [socket, stateRef]);

  // Heartbeat ping for latency tracking
  useEffect(() => {
    const id = window.setInterval(() => socket.send({ t: "ping", ts: Date.now() }), 4000);
    return () => clearInterval(id);
  }, [socket]);

  // React re-render whenever a server message arrives (for HUD/chat)
  useEffect(() => {
    const off = socket.on(() => forceRender((n) => n + 1));
    return off;
  }, [socket, forceRender]);

  const me = getMyPlayer(stateRef.current);
  const onShip = me?.scene === Scene.Ship;
  const showTerminal = terminalOpen && onShip;

  // Hint text when standing on a ship interaction tile
  const tileHint = useMemo(() => {
    if (!me || !onShip || !stateRef.current.shipGrid) return null;
    const g = stateRef.current.shipGrid;
    const t = g.tiles[Math.floor(me.pos.y) * g.w + Math.floor(me.pos.x)];
    if (t === TileType.ShipExit) return "Press E to LAUNCH";
    if (t === TileType.CompanyDesk) return "Press E to SELL all stowed scrap";
    return null;
  }, [me?.pos.x, me?.pos.y, onShip, stateRef.current.shipGrid]);

  // Cutscene overlay: shown for ~3.5s after a scene_facility message arrives.
  // Server also pins players in place during this time (phase = "landing").
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
          onLaunch={() => socket.send({ t: "launch" })}
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
      <div className="help-overlay">
        <div><b>WASD</b> move &middot; <b>mouse</b> aim &middot; <b>E</b> interact &middot; <b>G</b> drop</div>
        <div><b>F</b> flashlight &middot; <b>Tab</b> terminal &middot; <b>Enter</b> chat &middot; <b>V</b> voice</div>
        <div><b>1&ndash;4</b> hotbar slot</div>
      </div>
    </>
  );
}
