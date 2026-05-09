import {
  PROXIMITY_VOICE_MAX_RADIUS,
  Scene,
  VOICE_WALL_ATTENUATION,
} from "@quota/shared";
import type { ClientMsg, GameSnapshot, PlayerId, ServerMsg, TileGrid, Vec2 } from "@quota/shared";

const RTC_CFG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type Peer = {
  pc: RTCPeerConnection;
  remoteAudio: HTMLAudioElement;
  remoteStream: MediaStream | null;
  gain: GainNode | null;
  source: MediaStreamAudioSourceNode | null;
  panner: StereoPannerNode | null;
};

type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit | null };

export class VoiceMesh {
  private localStream: MediaStream | null = null;
  private peers = new Map<PlayerId, Peer>();
  private send: (msg: ClientMsg) => void;
  private myId: PlayerId | null = null;
  private audioCtx: AudioContext | null = null;
  private muted = true;

  constructor(send: (msg: ClientMsg) => void) {
    this.send = send;
  }

  setMyId(id: PlayerId): void {
    this.myId = id;
  }

  async setActive(on: boolean): Promise<void> {
    if (on && !this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch (err) {
        console.warn("[voice] mic denied:", err);
        return;
      }
    }
    this.muted = !on;
    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) t.enabled = on;
    }
    this.send({ t: "voice_active", on });
  }

  /** Initiate or update peer connections to all other players currently in the lobby. */
  async ensurePeer(playerId: PlayerId, initiator: boolean): Promise<void> {
    if (playerId === this.myId) return;
    if (this.peers.has(playerId)) return;
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    const pc = new RTCPeerConnection(RTC_CFG);
    const remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    const peer: Peer = { pc, remoteAudio, remoteStream: null, gain: null, source: null, panner: null };
    this.peers.set(playerId, peer);

    pc.onicecandidate = (e) => {
      this.send({ t: "signal", toPlayerId: playerId, payload: { kind: "ice", candidate: e.candidate ?? null } satisfies SignalPayload });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0]!;
      peer.remoteStream = stream;
      remoteAudio.srcObject = stream;
      // Wire through audio graph for spatial gain
      try {
        peer.source = this.audioCtx!.createMediaStreamSource(stream);
        peer.gain = this.audioCtx!.createGain();
        peer.panner = this.audioCtx!.createStereoPanner();
        peer.source.connect(peer.gain).connect(peer.panner).connect(this.audioCtx!.destination);
        peer.gain.gain.value = 0.0; // start silent until proximity update
        // Also mute the bare audio element so we only hear gained graph
        remoteAudio.volume = 0;
      } catch (err) {
        console.warn("[voice] audio graph err", err);
      }
    };
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) pc.addTrack(track, this.localStream);
    } else {
      // Add a silent placeholder so we can still receive
      try {
        const ctx = this.audioCtx!;
        const dst = ctx.createMediaStreamDestination();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g).connect(dst);
        osc.start();
        for (const track of dst.stream.getAudioTracks()) pc.addTrack(track, dst.stream);
      } catch (err) {
        console.warn("[voice] silent track err", err);
      }
    }

    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send({
        t: "signal",
        toPlayerId: playerId,
        payload: { kind: "offer", sdp: offer.sdp ?? "" } satisfies SignalPayload,
      });
    }
  }

  async handleSignal(fromId: PlayerId, payloadRaw: unknown): Promise<void> {
    const payload = payloadRaw as SignalPayload;
    if (!payload) return;
    if (!this.peers.has(fromId)) {
      await this.ensurePeer(fromId, false);
    }
    const peer = this.peers.get(fromId);
    if (!peer) return;
    const pc = peer.pc;
    if (payload.kind === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      this.send({
        t: "signal",
        toPlayerId: fromId,
        payload: { kind: "answer", sdp: ans.sdp ?? "" } satisfies SignalPayload,
      });
    } else if (payload.kind === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    } else if (payload.kind === "ice") {
      try {
        if (payload.candidate) await pc.addIceCandidate(payload.candidate);
      } catch (err) {
        console.warn("[voice] ICE add err", err);
      }
    }
  }

  /** Recompute spatial gain per peer from snapshot positions and current grid. */
  updateProximity(snap: GameSnapshot, grid: TileGrid | null, myPos: Vec2 | null, myScene: Scene | null): void {
    if (!this.audioCtx) return;
    for (const [pid, peer] of this.peers) {
      if (!peer.gain || !peer.panner) continue;
      const other = snap.players.find((p) => p.id === pid);
      if (!other || !myPos || other.scene !== myScene || !grid) {
        peer.gain.gain.value = 0;
        continue;
      }
      const dx = other.pos.x - myPos.x;
      const dy = other.pos.y - myPos.y;
      const dist = Math.hypot(dx, dy);
      let vol = Math.max(0, 1 - dist / PROXIMITY_VOICE_MAX_RADIUS);
      // Crude wall attenuation: count blocking tiles between
      const blockers = countBlockers(grid, myPos, other.pos);
      vol *= Math.pow(VOICE_WALL_ATTENUATION, blockers);
      peer.gain.gain.value = vol * vol; // perceptual curve
      // Stereo pan based on relative angle (forward-relative not implemented; use absolute X)
      const pan = Math.max(-0.9, Math.min(0.9, dx / PROXIMITY_VOICE_MAX_RADIUS));
      peer.panner.pan.value = pan;
    }
  }

  removePeer(playerId: PlayerId): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(playerId);
  }

  dispose(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.audioCtx?.close();
    this.audioCtx = null;
  }
}

function countBlockers(g: TileGrid, a: Vec2, b: Vec2): number {
  let x0 = Math.floor(a.x);
  let y0 = Math.floor(a.y);
  const x1 = Math.floor(b.x);
  const y1 = Math.floor(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let blockers = 0;
  for (let i = 0; i < 256; i++) {
    if (x0 === x1 && y0 === y1) return blockers;
    const t = g.tiles[y0 * g.w + x0];
    if (t === 2 /* Wall */ || t === 6 /* ShipWall */) blockers++;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return blockers;
}

export type ServerVoiceSignal = Extract<ServerMsg, { t: "signal" }>;
