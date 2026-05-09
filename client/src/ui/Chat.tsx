import { useEffect, useRef, useState } from "react";
import type { Socket } from "../net/socket.js";
import type { ClientGameState } from "../game/state.js";

export function Chat({
  socket,
  state,
  open,
  setOpen,
  onShip,
}: {
  socket: Socket;
  state: ClientGameState;
  open: boolean;
  setOpen: (b: boolean) => void;
  onShip: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [channel, setChannel] = useState<"proximity" | "ship">(onShip ? "ship" : "proximity");

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.chatLog.length]);

  return (
    <div className="chat" style={{ opacity: open ? 1 : 0.65 }}>
      <div className="chat-log" ref={logRef}>
        {state.chatLog.slice(-40).map((m, i) => (
          <div key={i} className={`chat-msg ${m.channel}`}>
            <span className="from">{m.fromName}: </span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      {open && (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (text) socket.send({ t: "chat", text, channel });
            setDraft("");
            setOpen(false);
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft("");
                setOpen(false);
              }
            }}
            placeholder="Say something… (Esc to cancel)"
            maxLength={200}
            autoFocus
          />
          <select value={channel} onChange={(e) => setChannel(e.target.value as "proximity" | "ship")}>
            <option value="proximity">Proximity</option>
            <option value="ship" disabled={!onShip}>
              Ship
            </option>
          </select>
        </form>
      )}
    </div>
  );
}
