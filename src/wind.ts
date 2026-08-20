interface Gust {
  id: number;
  x: number;
  dirX: number;
  strength: number;
  createdAt: number;
}

const gusts: Gust[] = [];

// Lets the visual layer track a gust across frames (e.g. to keep its
// swoosh/leaf shapes stable instead of re-randomizing them every draw).
let nextGustId = 1;

// How fast a gust's push travels across the field (in field-percent per
// second), how long it takes to fade, and how far its push spreads from its
// current position -- tuned so a drag across the whole field reads as one
// gust sweeping through, not a single instantaneous nudge everywhere at once.
const TRAVEL_SPEED = 60;
const DECAY_SECONDS = 1.1;
const MAX_LIFE_SECONDS = 3;
const SPREAD = 10;

export function addGust(x: number, dirX: number, strength: number): void {
  gusts.push({
    id: nextGustId++,
    x,
    dirX: dirX || 1,
    strength: Math.min(strength, 1),
    createdAt: performance.now() / 1000,
  });
}

function prune(now: number): void {
  for (let i = gusts.length - 1; i >= 0; i--) {
    if (now - gusts[i].createdAt > MAX_LIFE_SECONDS) {
      gusts.splice(i, 1);
    }
  }
}

// The push felt at a given field position right now, from every gust still
// alive -- signed, so it both sways a chime and picks the direction it tips.
export function windForceAt(xPercent: number, now: number): number {
  prune(now);
  let total = 0;
  for (const gust of gusts) {
    const elapsed = now - gust.createdAt;
    const decay = gust.strength * Math.exp(-elapsed / DECAY_SECONDS);
    const pos = gust.x + gust.dirX * TRAVEL_SPEED * elapsed;
    const dist = xPercent - pos;
    const falloff = Math.exp(-(dist * dist) / (2 * SPREAD * SPREAD));
    total += decay * falloff * gust.dirX;
  }
  return total;
}

export interface GustTrace {
  id: number;
  x: number;
  dirX: number;
  intensity: number;
}

// A rendering-only snapshot of where each gust currently is and how strong
// it still is -- separate from windForceAt so the visual layer never needs
// to duplicate the decay/travel math to draw what's actually happening.
export function gustTraces(now: number): GustTrace[] {
  prune(now);
  return gusts.map((gust) => {
    const elapsed = now - gust.createdAt;
    return {
      id: gust.id,
      x: gust.x + gust.dirX * TRAVEL_SPEED * elapsed,
      dirX: gust.dirX,
      intensity: gust.strength * Math.exp(-elapsed / DECAY_SECONDS),
    };
  });
}
