import type { WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { randomUUID } from "crypto";
import type { ClientMsg, ServerMsg } from "@quota/shared";
import { CLIENT_TIMEOUT_MS } from "@quota/shared";
import type { LobbyManager } from "../lobby/manager.js";

export type ClientCtx = {
  id: string;
  ws: WebSocket;
  name: string;
  color: string;
  lobbyCode: string | null;
  send: (msg: ServerMsg) => void;
  alive: boolean;
};

export function handleConnection(ws: WebSocket, _req: IncomingMessage, lobbyManager: LobbyManager): void {
  const id = randomUUID();
  let lastSeen = Date.now();

  const ctx: ClientCtx = {
    id,
    ws,
    name: "Contractor",
    color: "#cccccc",
    lobbyCode: null,
    alive: true,
    send: (msg) => {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(JSON.stringify(msg));
        } catch (err) {
          console.warn(`[ws] send error to ${id}:`, err);
        }
      }
    },
  };

  lobbyManager.registerClient(ctx);
  ctx.send({ t: "welcome", playerId: id });

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > CLIENT_TIMEOUT_MS) {
      console.log(`[ws] timeout for ${id}`);
      ws.terminate();
    }
  }, 5_000);

  ws.on("message", (data) => {
    lastSeen = Date.now();
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      console.warn(`[ws] bad json from ${id}`);
      return;
    }
    try {
      lobbyManager.handleMessage(ctx, msg);
    } catch (err) {
      console.error(`[ws] handler error for ${id}:`, err);
      ctx.send({ t: "error", message: "internal error" });
    }
  });

  ws.on("pong", () => {
    lastSeen = Date.now();
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    ctx.alive = false;
    lobbyManager.dropClient(ctx);
  });

  ws.on("error", (err) => {
    console.warn(`[ws] error for ${id}:`, err.message);
  });
}
