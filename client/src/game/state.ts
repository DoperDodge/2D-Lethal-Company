import type { GameSnapshot, PlayerId, PlayerState, ServerMsg, TileGrid, Vec2 } from "@quota/shared";
import { Scene } from "@quota/shared";

export type ClientGameState = {
  myId: PlayerId | null;
  lobbyCode: string | null;
  lobbyRoster: { id: PlayerId; name: string; color: string; ready: boolean }[];
  phase: GameSnapshot["phase"] | "lobby";
  shipGrid: TileGrid | null;
  facilityGrid: TileGrid | null;
  shipExitPad: Vec2 | null;
  snap: GameSnapshot | null;
  // Local prediction
  predictedPos: Vec2 | null;
  // Chat
  chatLog: { from: PlayerId; fromName: string; text: string; channel: "proximity" | "ship" | "system"; ts: number }[];
  // Voice peers (player ids who are actively transmitting)
  voicePeers: Set<PlayerId>;
  // Day-end / game-over toasts
  toast: string | null;
  toastUntil: number;
};

export function newState(): ClientGameState {
  return {
    myId: null,
    lobbyCode: null,
    lobbyRoster: [],
    phase: "lobby",
    shipGrid: null,
    facilityGrid: null,
    shipExitPad: null,
    snap: null,
    predictedPos: null,
    chatLog: [],
    voicePeers: new Set(),
    toast: null,
    toastUntil: 0,
  };
}

export function applyServerMsg(s: ClientGameState, msg: ServerMsg): void {
  switch (msg.t) {
    case "welcome":
      s.myId = msg.playerId;
      return;
    case "lobby_joined":
      s.lobbyCode = msg.code;
      s.myId = msg.you;
      s.lobbyRoster = msg.players;
      return;
    case "lobby_update":
      s.lobbyRoster = msg.players;
      s.phase = msg.phase;
      return;
    case "lobby_left":
      s.lobbyCode = null;
      s.lobbyRoster = [];
      s.shipGrid = null;
      s.facilityGrid = null;
      s.snap = null;
      s.predictedPos = null;
      s.phase = "lobby";
      return;
    case "scene_ship":
      s.shipGrid = msg.ship.scene;
      s.facilityGrid = null;
      s.shipExitPad = null;
      return;
    case "scene_facility":
      s.facilityGrid = msg.facility.scene;
      s.shipExitPad = msg.facility.shipExit;
      return;
    case "snapshot":
      s.snap = msg.snap;
      reconcilePrediction(s);
      return;
    case "chat":
      s.chatLog.push({
        from: msg.from,
        fromName: msg.fromName,
        text: msg.text,
        channel: msg.channel,
        ts: Date.now(),
      });
      if (s.chatLog.length > 100) s.chatLog.splice(0, s.chatLog.length - 100);
      return;
    case "peer_voice":
      if (msg.on) s.voicePeers.add(msg.playerId);
      else s.voicePeers.delete(msg.playerId);
      return;
    case "day_end":
      s.toast = `Day ended — ${msg.scrapTotal} credits stowed`;
      s.toastUntil = Date.now() + 4000;
      return;
    case "game_over":
      s.toast = `GAME OVER — ${msg.reason}`;
      s.toastUntil = Date.now() + 6000;
      return;
    case "error":
      s.toast = msg.message;
      s.toastUntil = Date.now() + 3000;
      return;
  }
}

export function getMyPlayer(s: ClientGameState): PlayerState | null {
  if (!s.snap || !s.myId) return null;
  return s.snap.players.find((p) => p.id === s.myId) ?? null;
}

export function activeGrid(s: ClientGameState): TileGrid | null {
  const me = getMyPlayer(s);
  if (!me) return s.shipGrid;
  return me.scene === Scene.Ship ? s.shipGrid : s.facilityGrid;
}

function reconcilePrediction(s: ClientGameState): void {
  // Snap predicted pos to authoritative pos. The simple v0.1 reconciliation
  // (the renderer interpolates from previous snapshot anyway).
  const me = getMyPlayer(s);
  if (!me) return;
  s.predictedPos = { x: me.pos.x, y: me.pos.y };
}
