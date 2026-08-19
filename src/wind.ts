interface Gust {
  x: number;
  dirX: number;
  strength: number;
  createdAt: number;
}

const gusts: Gust[] = [];

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
    x,
    dirX: dirX || 1,
    strength: Math.min(strength, 1),
    createdAt: performance.now() / 1000,
  });
}

// The push felt at a given field position right now, from every gust still
// alive -- signed, so it both sways a chime and picks the direction it tips.
export function windForceAt(xPercent: number, now: number): number {
  let total = 0;
  for (let i = gusts.length - 1; i >= 0; i--) {
    const gust = gusts[i];
    const elapsed = now - gust.createdAt;
    if (elapsed > MAX_LIFE_SECONDS) {
      gusts.splice(i, 1);
      continue;
    }
    const decay = gust.strength * Math.exp(-elapsed / DECAY_SECONDS);
    const pos = gust.x + gust.dirX * TRAVEL_SPEED * elapsed;
    const dist = xPercent - pos;
    const falloff = Math.exp(-(dist * dist) / (2 * SPREAD * SPREAD));
    total += decay * falloff * gust.dirX;
  }
  return total;
}
