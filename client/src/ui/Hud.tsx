import { ITEMS, PLAYER_INVENTORY_SLOTS, PLAYER_MAX_HEALTH } from "@quota/shared";
import type { ClientGameState } from "../game/state.js";
import { getMyPlayer } from "../game/state.js";

export function Hud({ state }: { state: ClientGameState }) {
  const me = getMyPlayer(state);
  const snap = state.displaySnap;
  if (!snap) return null;

  return (
    <div className="hud">
      <div className="hud-top">
        <div style={{ display: "flex", gap: 8 }}>
          <div className="hud-card">
            <div className="label">Credits</div>
            <div className="value">{snap.credits}</div>
          </div>
          <div className="hud-card">
            <div className="label">Quota</div>
            <div className="value">{snap.quota}</div>
          </div>
          <div className="hud-card">
            <div className="label">Stowed</div>
            <div className="value">{snap.scrapSold}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="hud-card">
            <div className="label">Day</div>
            <div className="value">{snap.dayNumber}</div>
          </div>
          <div className="hud-card">
            <div className="label">Days Left</div>
            <div className="value">{snap.daysRemaining}</div>
          </div>
          <div className="hud-card">
            <div className="label">Time</div>
            <div className="value">{formatTime(snap.timeRemaining)}</div>
          </div>
        </div>
      </div>
      {me && (
        <div className="hud-top" style={{ top: 64 }}>
          <div className="hud-card">
            <div className="label">HP</div>
            <div
              className="value"
              style={{
                color: me.hp > PLAYER_MAX_HEALTH * 0.4 ? "var(--good)" : "var(--danger)",
              }}
            >
              {Math.ceil(me.hp)}
            </div>
          </div>
          <div></div>
        </div>
      )}
      {me && (
        <div className="hud-bottom">
          {Array.from({ length: PLAYER_INVENTORY_SLOTS }).map((_, i) => {
            const slot = me.inventory[i];
            const def = slot ? ITEMS[slot.itemId] : null;
            return (
              <div key={i} className={`slot ${i === me.selectedSlot ? "selected" : ""}`}>
                <div className="key">{i + 1}</div>
                <div className="name">{def ? def.name : ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
