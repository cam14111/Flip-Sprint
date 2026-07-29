import { useEffect, useRef } from "react";

/**
 * A short canvas confetti burst for the finish line. Canvas rather than DOM
 * nodes so a few hundred pieces cost nothing, and it stops itself once the last
 * piece has fallen off screen.
 */
const COLORS = ["#22d3ee", "#f472b6", "#fbbf24", "#a78bfa", "#34d399"];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  color: string;
}

export const Confetti = ({ pieces = 140 }: { pieces?: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const items: Piece[] = Array.from({ length: pieces }, () => ({
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.5,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.6 + Math.random() * 2.6,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.24,
      angle: Math.random() * Math.PI,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of items) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.angle += p.spin;
        if (p.y < height + 30) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pieces]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
};
