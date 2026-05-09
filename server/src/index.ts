import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { LobbyManager } from "./lobby/manager.js";
import { handleConnection } from "./net/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const MAX_LOBBIES = Number(process.env.MAX_LOBBIES ?? 50);
const MAX_PLAYERS_PER_LOBBY = Number(process.env.MAX_PLAYERS_PER_LOBBY ?? 4);

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, uptime: process.uptime() });
});

// Serve client static build in production (multi-stage Docker copies it here)
const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else if (NODE_ENV === "production") {
  console.warn(`[server] client/dist not found at ${clientDist}`);
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

const lobbyManager = new LobbyManager({ maxLobbies: MAX_LOBBIES, maxPlayers: MAX_PLAYERS_PER_LOBBY });
lobbyManager.start();

wss.on("connection", (ws, req) => {
  handleConnection(ws, req, lobbyManager);
});

httpServer.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (env=${NODE_ENV})`);
  console.log(`[server] ws endpoint: ws://localhost:${PORT}/ws`);
});

const shutdown = (signal: string) => {
  console.log(`[server] received ${signal}, shutting down`);
  lobbyManager.stop();
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
