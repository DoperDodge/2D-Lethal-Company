import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "../net/socket.js";
import { activeGrid, getMyPlayer, type ClientGameState } from "../game/state.js";
import { Renderer } from "../game/renderer.js";
import { InputController } from "../game/input.js";
import { VoiceMesh } from "../net/voice.js";
import { Scene, TileType } from "@quota/shared";
import { Hud } from "./Hud.js";
import { Chat } from "./Chat.js";
import { Terminal } from "./Terminal.js";

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
        // Initiate to peers with id < ours to avoid offer/offer races
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

  // Game loop
  useEffect(() => {
    let raf = 0;
    let lastInputSentAt = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const c = canvasRef.current!;
      const renderer = rendererRef.current!;
      const input = inputRef.current;
      const state = stateRef.current;

      // Edges: handle UI / interactions
      const edges = input.consumeEdges();
      if (edges.chatToggle) {
        setChatOpen((v) => !v);
        input.forceRefocus();
      }
      if (edges.terminalToggle) {
        setTerminalOpen((v) => !v);
      }
      if (edges.flashlightToggle) {
        const me = getMyPlayer(state);
        if (me) me.flashlightOn = !me.flashlightOn;
      }
      if (edges.voicePressed) voiceRef.current?.setActive(true);
      if (edges.voiceReleased) voiceRef.current?.setActive(false);

      // Compute facing from mouse for sending to server
      const facing = renderer.computeFacing(c, { x: input.state.mouseX, y: input.state.mouseY });
      const me = getMyPlayer(state);
      const flashlightOn = !!me?.flashlightOn;

      // Send input @ 30Hz
      if (now - lastInputSentAt > 1000 / 30) {
        lastInputSentAt = now;
        seqRef.current++;
        socket.send({
          t: "input",
          seq: seqRef.current,
          mv: { x: input.state.mvx, y: input.state.mvy },
          facing,
          flashlight: flashlightOn,
          interact: edges.interact,
          drop: edges.drop,
          selectedSlot: input.state.selectedSlot,
        });
      }

      // Local prediction: integrate movement client-side
      if (me) {
        const grid = activeGrid(state);
        if (grid && state.predictedPos) {
          const speed = 4.0;
          let mx = input.state.mvx,
            my = input.state.mvy;
          const mag = Math.hypot(mx, my);
          if (mag > 1) {
            mx /= mag;
            my /= mag;
          }
          const nx = state.predictedPos.x + mx * speed * dt;
          const ny = state.predictedPos.y + my * speed * dt;
          if (canStepTo(grid, nx, state.predictedPos.y)) state.predictedPos.x = nx;
          if (canStepTo(grid, state.predictedPos.x, ny)) state.predictedPos.y = ny;
          // Soft pull toward server position
          const sx = me.pos.x;
          const sy = me.pos.y;
          state.predictedPos.x += (sx - state.predictedPos.x) * Math.min(1, dt * 4);
          state.predictedPos.y += (sy - state.predictedPos.y) * Math.min(1, dt * 4);
        } else if (grid) {
          state.predictedPos = { x: me.pos.x, y: me.pos.y };
        }
      }

      // Render
      renderer.draw(state, { x: input.state.mouseX, y: input.state.mouseY });

      // Update voice proximity
      const snap = state.snap;
      const grid = activeGrid(state);
      if (snap && voiceRef.current && me) {
        voiceRef.current.updateProximity(snap, grid, me.pos, me.scene);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [socket, stateRef]);

  // Heartbeat ping for latency
  useEffect(() => {
    const id = window.setInterval(() => socket.send({ t: "ping", ts: Date.now() }), 4000);
    return () => clearInterval(id);
  }, [socket]);

  // Subscribe to chat / scene messages so React re-renders the HUD/chat
  useEffect(() => {
    const off = socket.on(() => forceRender((n) => n + 1));
    return off;
  }, [socket, forceRender]);

  const me = getMyPlayer(stateRef.current);
  const onShip = me?.scene === Scene.Ship;
  const showTerminal = terminalOpen && onShip;

  // Auto-show toast for tile interactions on ship: hint when standing on store/desk
  const tileHint = useMemo(() => {
    if (!me || !onShip || !stateRef.current.shipGrid) return null;
    const g = stateRef.current.shipGrid;
    const t = g.tiles[Math.floor(me.pos.y) * g.w + Math.floor(me.pos.x)];
    if (t === TileType.ShipExit) return "Press E to LAUNCH";
    if (t === TileType.CompanyDesk) return "Press E to SELL all stowed scrap";
    return null;
  }, [me?.pos.x, me?.pos.y, onShip, stateRef.current.shipGrid]);

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
      {tileHint && <div className="toast">{tileHint}</div>}
      {stateRef.current.toast && Date.now() < stateRef.current.toastUntil && (
        <div className="toast" style={{ top: 110 }}>
          {stateRef.current.toast}
        </div>
      )}
      {!me?.alive && stateRef.current.snap && (
        <div className="kill-screen">
          <h1>YOU DIED</h1>
          <p>Wait for the ship to leave orbit.</p>
        </div>
      )}
      <div className="help-overlay">
        <div><b>WASD</b> move · <b>mouse</b> aim · <b>E</b> interact · <b>G</b> drop</div>
        <div><b>F</b> flashlight · <b>Tab</b> terminal · <b>Enter</b> chat · <b>V</b> voice</div>
        <div><b>1–4</b> hotbar slot</div>
      </div>
    </>
  );
}

function canStepTo(g: { w: number; h: number; tiles: Uint8Array }, fx: number, fy: number): boolean {
  const r = 0.3;
  const corners: Array<[number, number]> = [
    [fx - r, fy - r],
    [fx + r, fy - r],
    [fx - r, fy + r],
    [fx + r, fy + r],
  ];
  for (const [x, y] of corners) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= g.w || iy >= g.h) return false;
    const t = g.tiles[iy * g.w + ix];
    if (t === TileType.Wall || t === TileType.ShipWall || t === TileType.Empty) return false;
  }
  return true;
}
