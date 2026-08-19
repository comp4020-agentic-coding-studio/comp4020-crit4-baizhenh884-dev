import { gustTraces } from "./wind";

// Draws each active gust as a horizontal streak, thicker and more opaque
// the stronger the gust currently is. A sustained air-drag keeps adding
// strong, overlapping gusts near wherever the pointer lingers, so the
// streaks visibly thicken there -- a chime's ring, by contrast, is a glow
// on the chime itself, never a mark on this canvas.
export function initWindVisuals(field: HTMLElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

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

    for (const trace of gustTraces(now)) {
      if (trace.intensity < 0.03) {
        continue;
      }
      const x = (trace.x / 100) * width;
      const y = height * 0.55;
      const length = width * 0.14;
      const thickness = (1 + trace.intensity * 12) * (window.devicePixelRatio || 1);

      ctx.strokeStyle = `rgba(255, 205, 140, ${Math.min(trace.intensity, 0.75)})`;
      ctx.lineWidth = thickness;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - (trace.dirX * length) / 2, y);
      ctx.lineTo(x + (trace.dirX * length) / 2, y);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
