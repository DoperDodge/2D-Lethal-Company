import type { GameSnapshot, LobbyCode, PlayerId, PlayerState, Vec2, FacilityState, ShipState, LobbyPhase, ItemId } from "./types.js";

// ────────────────────────────────────────────────────────
// Client -> Server messages
// ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: "hello"; name: string; color: string }
  | { t: "create_lobby" }
  | { t: "join_lobby"; code: LobbyCode }
  | { t: "leave_lobby" }
  | { t: "ready"; ready: boolean }
  | { t: "input"; seq: number; mv: Vec2; facing: number; flashlight: boolean; interact: boolean; drop: boolean; selectedSlot: number }
  | { t: "chat"; text: string; channel: "proximity" | "ship" }
  | { t: "buy"; itemId: ItemId; qty: number }
  | { t: "select_moon"; moonId: string }
  | { t: "launch" }
  | { t: "return_to_orbit" }
  | { t: "signal"; toPlayerId: PlayerId; payload: unknown } // WebRTC SDP/ICE
  | { t: "voice_active"; on: boolean }
  | { t: "ping"; ts: number };

// ────────────────────────────────────────────────────────
// Server -> Client messages
// ────────────────────────────────────────────────────────
export type ServerMsg =
  | { t: "welcome"; playerId: PlayerId }
  | { t: "lobby_joined"; code: LobbyCode; you: PlayerId; players: { id: PlayerId; name: string; color: string; ready: boolean }[] }
  | { t: "lobby_update"; players: { id: PlayerId; name: string; color: string; ready: boolean }[]; phase: LobbyPhase }
  | { t: "lobby_left" }
  | { t: "error"; message: string }
  | { t: "scene_ship"; ship: ShipState }
  | { t: "scene_facility"; facility: FacilityState }
  | { t: "snapshot"; snap: GameSnapshot; ackSeq: number }
  | { t: "chat"; from: PlayerId; fromName: string; text: string; channel: "proximity" | "ship" | "system" }
  | { t: "signal"; fromPlayerId: PlayerId; payload: unknown }
  | { t: "peer_voice"; playerId: PlayerId; on: boolean }
  | { t: "day_end"; survivors: PlayerId[]; scrapTotal: number }
  | { t: "game_over"; reason: string; finalQuotaCycle: number }
  | { t: "pong"; ts: number };

export const STORE_CATALOG_VERSION = 1;
