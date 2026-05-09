import { useState } from "react";
import { ITEMS, MOONS, STORE_ITEMS, type ItemId } from "@quota/shared";
import type { ClientGameState } from "../game/state.js";

export function Terminal({
  state,
  onClose,
  onBuy,
  onSelectMoon,
  onLaunch,
}: {
  state: ClientGameState;
  onClose: () => void;
  onBuy: (itemId: ItemId, qty: number) => void;
  onSelectMoon: (moonId: string) => void;
  onLaunch: () => void;
}) {
  const [tab, setTab] = useState<"store" | "moons">("store");
  const credits = state.snap?.credits ?? 0;
  return (
    <div className="terminal">
      <h2>SHIP TERMINAL</h2>
      <button className="close" onClick={onClose}>
        ×
      </button>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        <button
          style={{ flex: 1, border: "none", background: tab === "store" ? "var(--bg-elev-2)" : "transparent" }}
          onClick={() => setTab("store")}
        >
          Store
        </button>
        <button
          style={{ flex: 1, border: "none", background: tab === "moons" ? "var(--bg-elev-2)" : "transparent" }}
          onClick={() => setTab("moons")}
        >
          Moons
        </button>
      </div>
      <div className="body">
        {tab === "store" ? (
          <>
            {STORE_ITEMS.map((id) => {
              const def = ITEMS[id]!;
              return (
                <div key={id} className="item">
                  <div style={{ flex: 1 }}>
                    <div className="name">{def.name}</div>
                    <div className="desc">{def.description}</div>
                  </div>
                  <div className="price">{def.price}cr</div>
                  <button disabled={(def.price ?? 0) > credits} onClick={() => onBuy(id, 1)}>
                    Buy
                  </button>
                </div>
              );
            })}
          </>
        ) : (
          <>
            {Object.values(MOONS).map((m) => (
              <div key={m.id} className="item">
                <div style={{ flex: 1 }}>
                  <div className="name">{m.name}</div>
                  <div className="desc">{m.description}</div>
                </div>
                <div className="price">{m.difficulty.toUpperCase()}</div>
                <button onClick={() => onSelectMoon(m.id)}>Select</button>
              </div>
            ))}
            <div style={{ marginTop: 18, textAlign: "right" }}>
              <button className="primary" onClick={onLaunch}>
                LAUNCH
              </button>
            </div>
          </>
        )}
      </div>
      <div className="footer">
        <span>Crew Credits: {credits}</span>
        <span style={{ color: "var(--fg-dim)" }}>Stowed: {state.snap?.scrapSold ?? 0}</span>
      </div>
    </div>
  );
}
