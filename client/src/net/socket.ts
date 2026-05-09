import type { ClientMsg, ServerMsg } from "@quota/shared";

export type ConnState = "disconnected" | "connecting" | "open";
export type Listener = (msg: ServerMsg) => void;

export class Socket {
  private url: string;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private connListeners = new Set<(s: ConnState) => void>();
  private state: ConnState = "disconnected";
  private reconnectTimer: number | null = null;
  private retryDelay = 500;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Vite proxies /ws to localhost:3001 in dev
      this.url = `${proto}//${window.location.host}/ws`;
    }
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setState("connecting");
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener("open", () => {
      this.retryDelay = 500;
      this.setState("open");
    });
    this.ws.addEventListener("close", () => {
      this.setState("disconnected");
      this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      // close handler will fire too
    });
    this.ws.addEventListener("message", (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 8000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(msg: ClientMsg): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onState(l: (s: ConnState) => void): () => void {
    this.connListeners.add(l);
    l(this.state);
    return () => this.connListeners.delete(l);
  }

  private setState(s: ConnState): void {
    this.state = s;
    for (const l of this.connListeners) l(s);
  }

  getState(): ConnState {
    return this.state;
  }
}
