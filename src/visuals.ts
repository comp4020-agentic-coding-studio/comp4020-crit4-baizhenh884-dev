import { gustTraces } from "./wind";

// A handful of slow, softly glowing motes drifting across the field at all
// times -- purely decorative (no audio, nothing gated on user interaction),
// so the scene reads as moving air worth stirring even before anyone has
// touched it, without ever risking the silent-on-load rule. Positions are
// seeded once and then driven by elapsed time, not stepped/mutated, so
// there's no per-frame state to keep in sync with resizes.
interface Mote {
  seedX: number;
  seedY: number;
  driftSpeed: number;
  bobSpeed: number;
  bobAmount: number;
  phase: number;
  radius: number;
}

const MOTE_COUNT = 14;

function createMotes(): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < MOTE_COUNT; i++) {
    motes.push({
      seedX: Math.random(),
      seedY: 0.15 + Math.random() * 0.7,
      driftSpeed: 0.015 + Math.random() * 0.02,
      bobSpeed: 0.15 + Math.random() * 0.25,
      bobAmount: 0.02 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      radius: 1.1 + Math.random() * 1.8,
    });
  }
  return motes;
}

// Draws each active gust as a soft, glowing streak, thicker and brighter
// the stronger the gust currently is. A sustained air-drag keeps adding
// strong, overlapping gusts near wherever the pointer lingers, so the
// streaks visibly thicken there -- a chime's ring, by contrast, is a glow
// on the chime itself, never a mark on this canvas.
export function initWindVisuals(field: HTMLElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const motes = createMotes();

  function resize(): void {
    const rect = field.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }
  resize();
  window.addEventListener("resize", resize);

  const draw = (): void => {
    const now = performance.now() / 1000;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const ratio = window.devicePixelRatio || 1;
    for (const mote of motes) {
      const x = (((mote.seedX + now * mote.driftSpeed) % 1) * width + width) % width;
      const y = (mote.seedY + Math.sin(now * mote.bobSpeed + mote.phase) * mote.bobAmount) * height;
      const radius = mote.radius * ratio;
      const flicker = 0.35 + 0.25 * Math.sin(now * mote.bobSpeed * 1.7 + mote.phase);

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 4);
      gradient.addColorStop(0, `rgba(255, 222, 170, ${flicker})`);
      gradient.addColorStop(1, "rgba(255, 222, 170, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const trace of gustTraces(now)) {
      if (trace.intensity < 0.03) {
        continue;
      }
      const x = (trace.x / 100) * width;
      const y = height * 0.55;
      const length = width * 0.14;
      const thickness = (1 + trace.intensity * 12) * ratio;

      ctx.save();
      ctx.shadowColor = `rgba(255, 190, 120, ${Math.min(trace.intensity, 0.85)})`;
      ctx.shadowBlur = 10 * ratio;
      ctx.strokeStyle = `rgba(255, 215, 160, ${Math.min(trace.intensity, 0.75)})`;
      ctx.lineWidth = thickness;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - (trace.dirX * length) / 2, y);
      ctx.lineTo(x + (trace.dirX * length) / 2, y);
      ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
