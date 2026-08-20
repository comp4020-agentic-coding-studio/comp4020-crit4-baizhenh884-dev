import { gustTraces, type GustTrace } from "./wind";

// Warm, dusk-garden leaf tints (RGB triples, alpha applied at draw time) --
// shares its family of tones with the sky/glow colours in styles.css so
// leaves read as part of the scene rather than a foreign sprite.
const LEAF_COLORS = ["196,154,108", "168,118,96", "150,130,90", "210,170,140"];

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, colorIndex: number, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgba(${LEAF_COLORS[colorIndex % LEAF_COLORS.length]}, 1)`;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.quadraticCurveTo(0, -size * 0.65, size, 0);
  ctx.quadraticCurveTo(0, size * 0.65, -size, 0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = "rgba(255, 244, 220, 0.8)";
  ctx.lineWidth = Math.max(0.5, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(-size * 0.75, 0);
  ctx.lineTo(size * 0.75, 0);
  ctx.stroke();
  ctx.restore();
}

// A single curved "swoosh" -- a motion-line arc that's thin at both ends
// and thickest in the middle, drawn as short segments along a quadratic
// curve so the taper and per-segment fade can vary smoothly along its
// length, rather than one uniform-width stroke.
function drawSwooshLine(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  ctrlX: number,
  ctrlY: number,
  endX: number,
  endY: number,
  maxThickness: number,
  alpha: number,
): void {
  const segments = 14;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 230, 180, 0.4)";
  ctx.shadowBlur = maxThickness * 1.1;
  ctx.strokeStyle = "rgba(255, 244, 218, 0.75)";

  let prevX = startX;
  let prevY = startY;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const oneMinusT = 1 - t;
    const x = oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * ctrlX + t * t * endX;
    const y = oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * ctrlY + t * t * endY;
    const taper = Math.sin(Math.PI * t);

    ctx.globalAlpha = alpha * (0.25 + 0.75 * taper);
    ctx.lineWidth = Math.max(0.4, maxThickness * taper);
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
    prevX = x;
    prevY = y;
  }
  ctx.restore();
}

interface SwooshLine {
  perpOffset: number;
  curveAmount: number;
  lengthScale: number;
  thicknessScale: number;
  flutterSpeed: number;
  flutterPhase: number;
}

interface GustLeaf {
  perpOffset: number;
  lagFraction: number;
  spinSpeed: number;
  spinPhase: number;
  size: number;
  colorIndex: number;
  wobbleSpeed: number;
  wobblePhase: number;
}

interface GustVisual {
  lines: SwooshLine[];
  leaves: GustLeaf[];
}

const MAX_GUST_LINES = 5;
const MAX_GUST_LEAVES = 2;

function createGustVisual(): GustVisual {
  const lines: SwooshLine[] = [];
  for (let i = 0; i < MAX_GUST_LINES; i++) {
    lines.push({
      perpOffset: (Math.random() - 0.5) * 0.7,
      curveAmount: 0.2 + Math.random() * 0.35,
      lengthScale: 0.75 + Math.random() * 0.5,
      thicknessScale: 0.6 + Math.random() * 0.7,
      flutterSpeed: 1 + Math.random() * 1.5,
      flutterPhase: Math.random() * Math.PI * 2,
    });
  }
  const leaves: GustLeaf[] = [];
  for (let i = 0; i < MAX_GUST_LEAVES; i++) {
    leaves.push({
      perpOffset: (Math.random() - 0.5) * 0.8,
      lagFraction: 0.2 + Math.random() * 0.6,
      spinSpeed: 2 + Math.random() * 4,
      spinPhase: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 0.5,
      colorIndex: Math.floor(Math.random() * LEAF_COLORS.length),
      wobbleSpeed: 1 + Math.random() * 2,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }
  return { lines, leaves };
}

// Draws one gust as a handful of curved motion-lines sweeping across the
// field in its travel direction, thin and tapered at both ends -- no cloud
// or puff shape, the lines alone carry the gust. Everything scales with
// the gust's current intensity: a strong gust gets more, longer, busier
// lines and a gentle one gets fewer, shorter, softer ones.
function drawGust(ctx: CanvasRenderingContext2D, visual: GustVisual, trace: GustTrace, width: number, height: number, ratio: number, now: number): void {
  const anchorX = (trace.x / 100) * width;
  const anchorY = height * 0.4;
  const baseLength = (70 + trace.intensity * 170) * ratio;
  const spanRadius = (14 + trace.intensity * 22) * ratio;

  const lineCount = Math.max(2, Math.min(MAX_GUST_LINES, Math.round(2 + trace.intensity * 3)));
  const leafCount = trace.intensity > 0.55 ? MAX_GUST_LEAVES : trace.intensity > 0.18 ? 1 : 0;
  const lineAlpha = Math.min(0.6, 0.18 + trace.intensity * 0.6);

  for (let i = 0; i < lineCount; i++) {
    const line = visual.lines[i];
    const length = baseLength * line.lengthScale;
    const perpOffset = line.perpOffset * spanRadius;
    const flutter = Math.sin(now * line.flutterSpeed * (0.6 + trace.intensity) + line.flutterPhase) * spanRadius * 0.25;

    const startX = anchorX + trace.dirX * length * 0.06;
    const startY = anchorY + perpOffset * 0.2;
    const endX = anchorX - trace.dirX * length * 0.94;
    const endY = anchorY + perpOffset;
    const ctrlX = anchorX - trace.dirX * length * 0.5;
    const ctrlY = anchorY + perpOffset * 0.5 - line.curveAmount * spanRadius + flutter;

    drawSwooshLine(ctx, startX, startY, ctrlX, ctrlY, endX, endY, (1.1 + trace.intensity * 2.2) * ratio * line.thicknessScale, lineAlpha);
  }

  for (let i = 0; i < leafCount; i++) {
    const leaf = visual.leaves[i];
    const lagDistance = baseLength * leaf.lagFraction;
    const leafX = anchorX - trace.dirX * lagDistance;
    const leafY = anchorY + leaf.perpOffset * spanRadius + Math.sin(now * leaf.wobbleSpeed + leaf.wobblePhase) * spanRadius * 0.35;
    const angle = now * leaf.spinSpeed * (0.6 + trace.intensity) + leaf.spinPhase;
    const size = (3.5 + trace.intensity * 4) * leaf.size * ratio;
    drawLeaf(ctx, leafX, leafY, size, angle, leaf.colorIndex, Math.min(0.75, 0.3 + trace.intensity * 0.45));
  }
}

// A couple of very faint, slowly drifting curved lines at all times --
// purely decorative (no audio, nothing gated on user interaction), so the
// scene keeps breathing even before anyone has touched it, without ever
// risking the silent-on-load rule. Same shape language as an active gust's
// swooshes, just far softer and slower.
interface IdleLine {
  seedX: number;
  seedY: number;
  driftSpeed: number;
  driftDir: number;
  length: number;
  curveAmount: number;
  perpTilt: number;
  bobSpeed: number;
  bobAmount: number;
  phase: number;
  thickness: number;
}

const IDLE_LINE_COUNT = 3;

function createIdleLines(): IdleLine[] {
  const lines: IdleLine[] = [];
  for (let i = 0; i < IDLE_LINE_COUNT; i++) {
    lines.push({
      seedX: Math.random(),
      seedY: 0.2 + Math.random() * 0.55,
      driftSpeed: 0.008 + Math.random() * 0.012,
      driftDir: Math.random() < 0.5 ? -1 : 1,
      length: 0.1 + Math.random() * 0.08,
      curveAmount: 0.25 + Math.random() * 0.4,
      perpTilt: (Math.random() - 0.5) * 0.6,
      bobSpeed: 0.12 + Math.random() * 0.18,
      bobAmount: 0.02 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      thickness: 1.2 + Math.random() * 1,
    });
  }
  return lines;
}

export function initWindVisuals(field: HTMLElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const idleLines = createIdleLines();
  const gustVisuals = new Map<number, GustVisual>();

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
    const ratio = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, width, height);

    for (const line of idleLines) {
      const centerX = (((line.seedX + now * line.driftSpeed * line.driftDir) % 1) * width + width) % width;
      const centerY = (line.seedY + Math.sin(now * line.bobSpeed + line.phase) * line.bobAmount) * height;
      const length = line.length * width;
      const perpOffset = line.perpTilt * length * 0.3;
      const flicker = 0.06 + 0.04 * Math.sin(now * line.bobSpeed * 1.5 + line.phase);

      const startX = centerX + (length / 2) * line.driftDir;
      const startY = centerY + perpOffset * 0.2;
      const endX = centerX - (length / 2) * line.driftDir;
      const endY = centerY + perpOffset;
      const ctrlX = centerX;
      const ctrlY = centerY + perpOffset * 0.5 - line.curveAmount * length * 0.25;

      drawSwooshLine(ctx, startX, startY, ctrlX, ctrlY, endX, endY, line.thickness * ratio, flicker);
    }

    const traces = gustTraces(now);
    const liveIds = new Set(traces.map((trace) => trace.id));
    for (const id of gustVisuals.keys()) {
      if (!liveIds.has(id)) {
        gustVisuals.delete(id);
      }
    }

    for (const trace of traces) {
      if (trace.intensity < 0.03) {
        continue;
      }
      let visual = gustVisuals.get(trace.id);
      if (!visual) {
        visual = createGustVisual();
        gustVisuals.set(trace.id, visual);
      }
      drawGust(ctx, visual, trace, width, height, ratio, now);
    }

    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
