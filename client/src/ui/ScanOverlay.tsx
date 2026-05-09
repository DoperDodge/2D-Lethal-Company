import type { Vec2 } from "@quota/shared";

export type ScanResult = {
  id: number;
  name: string;
  value: number;
  worldPos: Vec2;
};

/**
 * Scan overlay: a non-interactive panel that lists item names + values for
 * everything inside the player's forward cone when they right-clicked.
 * Auto-fades after a few seconds (handled by the parent).
 */
export function ScanOverlay({ results, onDone: _onDone }: { results: ScanResult[]; onDone: () => void }) {
  const total = results.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0);
  return (
    <div className="scan-overlay">
      <div className="scan-header">
        SCAN <span className="scan-total">+{total} cr</span>
      </div>
      <div className="scan-list">
        {results.map((r, i) => (
          <div key={i} className="scan-row">
            <span className="scan-name">{r.name}</span>
            <span className="scan-value">{r.value > 0 ? `${r.value} cr` : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
