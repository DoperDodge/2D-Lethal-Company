import { LOBBY_CODE_LENGTH, TICK_MS } from "@quota/shared";
import type { ClientMsg, LobbyCode } from "@quota/shared";
import type { ClientCtx } from "../net/connection.js";
import { Lobby } from "./lobby.js";

export type LobbyManagerOpts = {
  maxLobbies: number;
  maxPlayers: number;
};

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // omit confusing chars

function makeCode(): LobbyCode {
  let code = "";
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export class LobbyManager {
  private lobbies = new Map<LobbyCode, Lobby>();
  private clients = new Map<string, ClientCtx>();
  private tickHandle: NodeJS.Timeout | null = null;
  private opts: LobbyManagerOpts;

  constructor(opts: LobbyManagerOpts) {
    this.opts = opts;
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tickAll(), TICK_MS);
    console.log(`[lobby] tick started @ ${1000 / TICK_MS}Hz`);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  registerClient(ctx: ClientCtx): void {
    this.clients.set(ctx.id, ctx);
  }

  dropClient(ctx: ClientCtx): void {
    this.clients.delete(ctx.id);
    if (ctx.lobbyCode) {
      const lobby = this.lobbies.get(ctx.lobbyCode);
      if (lobby) {
        lobby.removePlayer(ctx.id);
        if (lobby.isEmpty()) {
          console.log(`[lobby] disposing empty lobby ${lobby.code}`);
          this.lobbies.delete(lobby.code);
        }
      }
      ctx.lobbyCode = null;
    }
  }

  handleMessage(ctx: ClientCtx, msg: ClientMsg): void {
    switch (msg.t) {
      case "hello":
        ctx.name = sanitizeName(msg.name);
        ctx.color = sanitizeColor(msg.color);
        return;
      case "create_lobby": {
        if (this.lobbies.size >= this.opts.maxLobbies) {
          ctx.send({ t: "error", message: "Server lobby cap reached" });
          return;
        }
        if (ctx.lobbyCode) this.dropClientFromLobby(ctx);
        let code = makeCode();
        let attempts = 0;
        while (this.lobbies.has(code) && attempts < 10) {
          code = makeCode();
          attempts++;
        }
        const lobby = new Lobby(code, this.opts.maxPlayers);
        this.lobbies.set(code, lobby);
        lobby.addPlayer(ctx);
        ctx.lobbyCode = code;
        console.log(`[lobby] created ${code} by ${ctx.id}`);
        return;
      }
      case "join_lobby": {
        const code = String(msg.code ?? "").toUpperCase();
        const lobby = this.lobbies.get(code);
        if (!lobby) {
          ctx.send({ t: "error", message: "Lobby not found" });
          return;
        }
        if (lobby.isFull()) {
          ctx.send({ t: "error", message: "Lobby full" });
          return;
        }
        if (ctx.lobbyCode) this.dropClientFromLobby(ctx);
        lobby.addPlayer(ctx);
        ctx.lobbyCode = code;
        return;
      }
      case "leave_lobby":
        this.dropClientFromLobby(ctx);
        return;
      case "ping":
        ctx.send({ t: "pong", ts: msg.ts });
        return;
      default: {
        if (!ctx.lobbyCode) return;
        const lobby = this.lobbies.get(ctx.lobbyCode);
        if (!lobby) return;
        lobby.handleMessage(ctx, msg);
      }
    }
  }

  private dropClientFromLobby(ctx: ClientCtx): void {
    if (!ctx.lobbyCode) return;
    const lobby = this.lobbies.get(ctx.lobbyCode);
    if (lobby) {
      lobby.removePlayer(ctx.id);
      if (lobby.isEmpty()) {
        this.lobbies.delete(lobby.code);
      }
    }
    ctx.send({ t: "lobby_left" });
    ctx.lobbyCode = null;
  }

  private tickAll(): void {
    for (const lobby of this.lobbies.values()) {
      try {
        lobby.tick();
      } catch (err) {
        console.error(`[lobby ${lobby.code}] tick error:`, err);
      }
    }
  }
}

function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Contractor";
  return s.slice(0, 16).replace(/[^\w \-_.]/g, "");
}

function sanitizeColor(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return "#cccccc";
}
