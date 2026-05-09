import { useEffect, useMemo, useRef, useState } from "react";
import type { ConnState } from "../net/socket.js";
import { Socket } from "../net/socket.js";
import { newState, applyServerMsg, type ClientGameState } from "../game/state.js";
import { Lobby } from "./Lobby.js";
import { GameView } from "./GameView.js";

export function App() {
  const socket = useMemo(() => new Socket(), []);
  const stateRef = useRef<ClientGameState>(newState());
  const [, forceRender] = useState(0);
  const [connState, setConnState] = useState<ConnState>("disconnected");

  // Subscribe to socket
  useEffect(() => {
    const offMsg = socket.on((msg) => {
      applyServerMsg(stateRef.current, msg);
      forceRender((n) => n + 1);
    });
    const offState = socket.onState((s) => {
      setConnState(s);
    });
    socket.connect();
    return () => {
      offMsg();
      offState();
    };
  }, [socket]);

  const inLobby = !!stateRef.current.lobbyCode;
  const inGame = inLobby && stateRef.current.grid != null;

  return (
    <div className="game-root">
      {connState !== "open" && (
        <div className="connection-banner">
          {connState === "connecting" ? "Connecting…" : "Disconnected — retrying"}
        </div>
      )}
      {inGame ? (
        <GameView socket={socket} stateRef={stateRef} forceRender={forceRender} />
      ) : (
        <Lobby socket={socket} state={stateRef.current} forceRender={forceRender} />
      )}
    </div>
  );
}
