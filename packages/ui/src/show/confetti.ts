import { CONFETTI_MS } from '@vt/game-sdk/show';

/** Bright pieces that read on light and dark pages (the colour-blind-safe set). */
const COLOURS = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'];
const MAX_PIECES = 60;

/**
 * A confetti burst on a canvas (sized to its box × the device's pixel ratio), `offsetMs` into its
 * life, at most `MAX_PIECES` pieces; it clears and stops itself after `CONFETTI_MS`. Returns a stop.
 */
export function burst(canvas: HTMLCanvasElement, n: number, offsetMs = 0): () => void {
  const g = canvas.getContext('2d');
  if (!g) return () => {};
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = (canvas.width = Math.round(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.round(canvas.clientHeight * dpr));
  // Pieces are decoration only: Math.random is fine (no device needs the same ones).
  const pieces = Array.from({ length: Math.min(n, MAX_PIECES) }, (_, i) => ({
    x: w / 2,
    y: h * 0.6,
    vx: (Math.random() - 0.5) * w * 1.2,
    vy: -(0.6 + Math.random() * 0.8) * h,
    r: Math.random() * 6,
    s: (4 + Math.random() * 5) * dpr,
    c: COLOURS[i % COLOURS.length]!,
  }));
  const t0 = performance.now() - offsetMs;
  let frame = 0;
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    g.clearRect(0, 0, w, h);
    if (t * 1000 >= CONFETTI_MS) {
      frame = 0;
      return;
    }
    g.globalAlpha = Math.min(1, 3 * (1 - (t * 1000) / CONFETTI_MS));
    for (const p of pieces) {
      g.fillStyle = p.c;
      g.save();
      g.translate(p.x + p.vx * t, p.y + p.vy * t + 0.9 * h * t * t);
      g.rotate(p.r * t);
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    frame = requestAnimationFrame(draw);
  };
  draw();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    g.clearRect(0, 0, w, h);
  };
}
