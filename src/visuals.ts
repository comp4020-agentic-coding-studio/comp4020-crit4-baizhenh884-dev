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

// A soft, scalloped cloud-puff -- a cluster of overlapping translucent lobes
// plus a core circle, rather than one plain circle, so it reads as the
// bumpy hand-drawn cloud shape a gust leads with instead of a glowing dot.
function drawPuff(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(255, 248, 232, 0.55)";
  ctx.strokeStyle = "rgba(255, 244, 214, 0.5)";
  ctx.lineWidth = Math.max(1, radius * 0.06);
  const lobes = 6;
  for (let i = 0; i < lobes; i++) {
    const angle = (i / lobes) * Math.PI * 2;
    const lobeRadius = radius * (0.4 + 0.18 * Math.sin(i * 1.7 + 1));
    const lx = x + Math.cos(angle) * radius * 0.5;
    const ly = y + Math.sin(angle) * radius * 0.32;
    ctx.beginPath();
    ctx.arc(lx, ly, lobeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// One curved swoosh trailing behind the puff (opposite the travel
// direction), bowed via a quadratic control point so it reads as a sweep
// rather than a straight streak.
function drawSwoosh(
  ctx: CanvasRenderingContext2D,
  puffX: number,
  puffY: number,
  dirX: number,
  length: number,
  perpOffset: number,
  curveAmount: number,
  thickness: number,
  alpha: number,
): void {
  const startX = puffX - dirX * length * 0.1;
  const startY = puffY + perpOffset * 0.15;
  const midX = puffX - dirX * length * 0.5;
  const midY = puffY + perpOffset * 0.4 - curveAmount;
  const endX = puffX - dirX * length;
  const endY = puffY + perpOffset;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(255, 230, 180, 0.5)";
  ctx.shadowBlur = thickness * 1.4;
  ctx.strokeStyle = "rgba(255, 244, 218, 0.65)";
  ctx.lineWidth = thickness;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(midX, midY, endX, endY);
  ctx.stroke();
  ctx.restore();
}

interface SwooshLine {
  perpOffset: number;
  curveAmount: number;
  lengthScale: number;
  thicknessScale: number;
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

const MAX_GUST_LINES = 6;
const MAX_GUST_LEAVES = 4;

function createGustVisual(): GustVisual {
  const lines: SwooshLine[] = [];
  for (let i = 0; i < MAX_GUST_LINES; i++) {
    lines.push({
      perpOffset: (Math.random() - 0.5) * 0.9,
      curveAmount: 0.25 + Math.random() * 0.45,
      lengthScale: 0.7 + Math.random() * 0.6,
      thicknessScale: 0.55 + Math.random() * 0.8,
    });
  }
  const leaves: GustLeaf[] = [];
  for (let i = 0; i < MAX_GUST_LEAVES; i++) {
    leaves.push({
      perpOffset: (Math.random() - 0.5) * 0.8,
      lagFraction: 0.15 + Math.random() * 0.7,
      spinSpeed: 2 + Math.random() * 4,
      spinPhase: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 0.6,
      colorIndex: Math.floor(Math.random() * LEAF_COLORS.length),
      wobbleSpeed: 1 + Math.random() * 2,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }
  return { lines, leaves };
}

// Draws one gust as an illustrated puff of wind: a scalloped cloud-puff at
// the leading edge, several curved swooshes trailing behind it, and a
// handful of leaves caught along those swooshes, tumbling as they travel.
// Everything scales with the gust's current intensity, so a strong gust
// reads as a bigger, busier gust and a fading one visibly thins out.
function drawGust(ctx: CanvasRenderingContext2D, visual: GustVisual, trace: GustTrace, width: number, height: number, ratio: number, now: number): void {
  const puffX = (trace.x / 100) * width;
  const puffY = height * 0.4;
  const puffRadius = (12 + trace.intensity * 26) * ratio;
  const baseLength = (60 + trace.intensity * 150) * ratio;
  const spin = 0.6 + trace.intensity;

  const lineCount = Math.max(2, Math.round(2 + trace.intensity * (MAX_GUST_LINES - 2)));
  const leafCount = Math.max(1, Math.round(1 + trace.intensity * (MAX_GUST_LEAVES - 1)));
  const lineAlpha = Math.min(0.55, 0.15 + trace.intensity * 0.55);

  for (let i = 0; i < lineCount; i++) {
    const line = visual.lines[i];
    drawSwoosh(
      ctx,
      puffX,
      puffY,
      trace.dirX,
      baseLength * line.lengthScale,
      line.perpOffset * puffRadius * 1.6,
      line.curveAmount * puffRadius,
      (1.3 + trace.intensity * 2) * ratio * line.thicknessScale,
      lineAlpha,
    );
  }

  drawPuff(ctx, puffX, puffY, puffRadius, Math.min(0.8, 0.3 + trace.intensity * 0.6));

  for (let i = 0; i < leafCount; i++) {
    const leaf = visual.leaves[i];
    const lagDistance = baseLength * leaf.lagFraction;
    const leafX = puffX - trace.dirX * lagDistance;
    const leafY = puffY + leaf.perpOffset * puffRadius * 1.8 + Math.sin(now * leaf.wobbleSpeed + leaf.wobblePhase) * puffRadius * 0.35;
    const angle = now * leaf.spinSpeed * spin + leaf.spinPhase;
    const size = (4.5 + trace.intensity * 5.5) * leaf.size * ratio;
    drawLeaf(ctx, leafX, leafY, size, angle, leaf.colorIndex, Math.min(0.85, 0.35 + trace.intensity * 0.5));
  }
}

// A handful of faint leaves drifting slowly across the field at all times --
// purely decorative (no audio, nothing gated on user interaction), so the
// scene keeps breathing even before anyone has touched it, without ever
// risking the silent-on-load rule.
interface IdleLeaf {
  seedX: number;
  seedY: number;
  driftSpeed: number;
  driftDir: number;
  bobSpeed: number;
  bobAmount: number;
  phase: number;
  spinSpeed: number;
  size: number;
  colorIndex: number;
}

const IDLE_LEAF_COUNT = 7;

function createIdleLeaves(): IdleLeaf[] {
  const leaves: IdleLeaf[] = [];
  for (let i = 0; i < IDLE_LEAF_COUNT; i++) {
    leaves.push({
      seedX: Math.random(),
      seedY: 0.2 + Math.random() * 0.55,
      driftSpeed: 0.01 + Math.random() * 0.014,
      driftDir: Math.random() < 0.5 ? -1 : 1,
      bobSpeed: 0.15 + Math.random() * 0.2,
      bobAmount: 0.02 + Math.random() * 0.03,
      phase: Math.random() * Math.PI * 2,
      spinSpeed: 0.3 + Math.random() * 0.5,
      size: 3.5 + Math.random() * 2.5,
      colorIndex: Math.floor(Math.random() * LEAF_COLORS.length),
    });
  }
  return leaves;
}

export function initWindVisuals(field: HTMLElement, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const idleLeaves = createIdleLeaves();
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

    for (const leaf of idleLeaves) {
      const x = (((leaf.seedX + now * leaf.driftSpeed * leaf.driftDir) % 1) * width + width) % width;
      const y = (leaf.seedY + Math.sin(now * leaf.bobSpeed + leaf.phase) * leaf.bobAmount) * height;
      const angle = now * leaf.spinSpeed + leaf.phase;
      const flicker = 0.25 + 0.12 * Math.sin(now * leaf.bobSpeed * 1.6 + leaf.phase);
      drawLeaf(ctx, x, y, leaf.size * ratio, angle, leaf.colorIndex, flicker);
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
