import { useEffect, useRef, useState } from "react";
import { LANDING_CUTSCENE_MS } from "@quota/shared";

/**
 * Descent cutscene: animated starfield with a planet growing closer,
 * then a flash to white as the dropship touches down.
 *
 * Pure visual — server holds the player still during this window.
 */
export function LandingCutscene({ moonName, endsAt }: { moonName: string; endsAt: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    const stars: { x: number; y: number; depth: number }[] = [];
    for (let i = 0; i < 220; i++) {
      stars.push({ x: Math.random(), y: Math.random(), depth: 0.3 + Math.random() * 0.7 });
    }
    const start = endsAt - LANDING_CUTSCENE_MS;
    const draw = () => {
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = (c.width = c.clientWidth * dpr);
      const h = (c.height = c.clientHeight * dpr);
      const ctx = c.getContext("2d")!;
      const now = Date.now();
      const t = Math.min(1, Math.max(0, (now - start) / LANDING_CUTSCENE_MS));

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      // Stars: stream toward viewer (center), faster as t -> 1
      const speed = 0.04 + t * 0.18;
      for (const s of stars) {
        s.y += speed * (1 - s.depth);
        if (s.y > 1.05) s.y -= 1.1;
      }
      ctx.fillStyle = "#fff";
      for (const s of stars) {
        const dx = (s.x - 0.5) * (1 + (1 - s.depth) * 1.5) + 0.5;
        const px = dx * w;
        const py = s.y * h;
        const sz = (1.0 + (1 - s.depth) * 2.0) * dpr;
        ctx.globalAlpha = 0.4 + s.depth * 0.6;
        ctx.fillRect(px, py, sz, sz);
      }
      ctx.globalAlpha = 1;

      // Planet body — grows over the cutscene
      const planetR = (Math.min(w, h) * 0.18) * (0.6 + t * 2.4);
      const px = w / 2;
      const py = h * 0.55;
      const grad = ctx.createRadialGradient(px - planetR * 0.4, py - planetR * 0.5, planetR * 0.1, px, py, planetR);
      grad.addColorStop(0, "#5a4032");
      grad.addColorStop(0.6, "#2a1f18");
      grad.addColorStop(1, "#0a0707");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, planetR, 0, Math.PI * 2);
      ctx.fill();
      // Subtle band for the planet's terrain feel
      ctx.strokeStyle = "rgba(120, 70, 40, 0.35)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, planetR * 0.8, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      // Atmosphere glow
      ctx.strokeStyle = "rgba(255, 200, 130, 0.25)";
      ctx.lineWidth = 6 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, planetR + 6 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      // White flash on touchdown
      if (t > 0.85) {
        const flash = (t - 0.85) / 0.15;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash * 1.4)})`;
        ctx.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(draw);
      setTick((n) => n + 1);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [endsAt]);

  const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return (
    <div className="cutscene">
      <canvas ref={canvasRef} className="cutscene-canvas" />
      <div className="cutscene-text">
        <div className="cutscene-label">DESCENDING TO</div>
        <div className="cutscene-moon">{(moonName || "UNKNOWN MOON").toUpperCase()}</div>
        <div className="cutscene-eta">T-{remaining}s</div>
      </div>
    </div>
  );
}
