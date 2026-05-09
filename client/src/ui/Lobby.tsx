import { useEffect, useState } from "react";
import type { Socket } from "../net/socket.js";
import type { ClientGameState } from "../game/state.js";

const COLORS = ["#ffd14a", "#5fc97d", "#56b9e0", "#d676e0", "#ff7b5a", "#aabe55"];

export function Lobby({
  socket,
  state,
  forceRender,
}: {
  socket: Socket;
  state: ClientGameState;
  forceRender: (fn: (n: number) => number) => void;
}) {
  const stored = readStoredProfile();
  const [name, setName] = useState(stored.name);
  const [color, setColor] = useState(stored.color);
  const [code, setCode] = useState("");
  const [helloSent, setHelloSent] = useState(false);

  useEffect(() => {
    if (!helloSent) {
      socket.send({ t: "hello", name, color });
      setHelloSent(true);
    }
  }, [helloSent, socket, name, color]);

  const sendHello = () => {
    storeProfile(name, color);
    socket.send({ t: "hello", name, color });
  };

  const inLobby = !!state.lobbyCode;

  if (!inLobby) {
    return (
      <div className="lobby-root">
        <div className="lobby-card">
          <h1>QUOTA</h1>
          <p className="subtitle">2D top-down co-op salvage</p>
          <div className="row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              onBlur={sendHello}
              placeholder="Name"
            />
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                sendHello();
                socket.send({ t: "create_lobby" });
              }}
            >
              Create Lobby
            </button>
          </div>
          <div className="row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="Code"
              style={{ letterSpacing: 4, textAlign: "center" }}
            />
            <button
              onClick={() => {
                if (code.length >= 4) {
                  sendHello();
                  socket.send({ t: "join_lobby", code });
                }
              }}
            >
              Join
            </button>
          </div>
          <p style={{ color: "var(--fg-dim)", fontSize: 11, marginTop: 24, textAlign: "center" }}>
            Land on hostile moons. Scavenge scrap. Make it home before the door closes.
          </p>
        </div>
      </div>
    );
  }

  const me = state.lobbyRoster.find((p) => p.id === state.myId);
  const myReady = me?.ready ?? false;
  return (
    <div className="lobby-root">
      <div className="lobby-card">
        <h1>QUOTA</h1>
        <p className="subtitle">Lobby code — share with crewmates</p>
        <div className="code">{state.lobbyCode}</div>

        <div className="row">
          <button
            className={myReady ? "" : "primary"}
            onClick={() => {
              socket.send({ t: "ready", ready: !myReady });
              forceRender((n) => n + 1);
            }}
          >
            {myReady ? "Unready" : "Ready"}
          </button>
          <button onClick={() => socket.send({ t: "leave_lobby" })}>Leave</button>
        </div>

        <div className="roster">
          {state.lobbyRoster.map((p) => (
            <div key={p.id} className="row">
              <div className="swatch" style={{ background: p.color }} />
              <span>
                {p.name}
                {p.id === state.myId ? " (you)" : ""}
              </span>
              <span className={`ready-tag ${p.ready ? "yes" : ""}`}>
                {p.ready ? "READY" : "waiting"}
              </span>
            </div>
          ))}
        </div>

        <p style={{ color: "var(--fg-dim)", fontSize: 11, marginTop: 18 }}>
          Game starts when all crewmates are ready.
        </p>
      </div>
    </div>
  );
}

function readStoredProfile(): { name: string; color: string } {
  try {
    const raw = localStorage.getItem("quota.profile");
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { name: `Pilot${Math.floor(Math.random() * 99)}`, color: COLORS[Math.floor(Math.random() * COLORS.length)]! };
}
function storeProfile(name: string, color: string): void {
  try {
    localStorage.setItem("quota.profile", JSON.stringify({ name, color }));
  } catch {
    /* ignore */
  }
}
