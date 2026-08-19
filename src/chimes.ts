import { playChime, setPaletteBrightness } from "./audio";
import { addGust, windForceAt } from "./wind";

interface Chime {
  button: HTMLButtonElement;
  hanger: HTMLElement;
  midi: number;
  duration: number;
  x: number; // position in the field, 0-100
  angle: number;
  angularVelocity: number;
  stiffness: number;
  damping: number;
  lastRungAt: number;
}

// Bigger chimes (longer tubes, in the markup) ring lower and longer, like a
// real wind chime -- size hints at pitch, so no menu is needed to find it.
function durationForIndex(index: number, count: number): number {
  const longest = 2.2;
  const shortest = 0.8;
  const t = index / (count - 1);
  return longest - t * (longest - shortest);
}

// AudioContext creation must happen inside a real user-gesture handler, so
// every entry point that can trigger the *first* sound sets this before
// ringing. Physics-driven ringing (wind sway) is gated on it too, so an
// idle chime's ambient nudge can never be what makes the page's first sound.
let hasInteracted = false;

function markInteracted(): void {
  hasInteracted = true;
}

function ring(chime: Chime): void {
  playChime(chime.midi, chime.duration);
  chime.button.classList.add("ringing");
  window.setTimeout(() => {
    chime.button.classList.remove("ringing");
  }, chime.duration * 1000);
}

// How fast a chime has to be swinging before it counts as "struck" --
// crossing this is what turns wind (or a strum) into an actual ring.
const RING_VELOCITY = 1.6;
const MAX_ANGLE = 0.5;
const WIND_FORCE_SCALE = 26;

function stepPhysics(chime: Chime, dt: number, now: number): void {
  const wind = windForceAt(chime.x, now) * WIND_FORCE_SCALE;
  const accel = -chime.stiffness * chime.angle - chime.damping * chime.angularVelocity + wind;
  const wasBelowThreshold = Math.abs(chime.angularVelocity) < RING_VELOCITY;

  chime.angularVelocity += accel * dt;
  chime.angle += chime.angularVelocity * dt;

  if (chime.angle > MAX_ANGLE) {
    chime.angle = MAX_ANGLE;
    chime.angularVelocity *= -0.4;
  } else if (chime.angle < -MAX_ANGLE) {
    chime.angle = -MAX_ANGLE;
    chime.angularVelocity *= -0.4;
  }

  chime.hanger.style.transform = `rotate(${chime.angle}rad)`;

  const crossedThreshold = wasBelowThreshold && Math.abs(chime.angularVelocity) >= RING_VELOCITY;
  const cooldownElapsed = now - chime.lastRungAt > Math.max(0.15, chime.duration * 0.2);
  if (hasInteracted && crossedThreshold && cooldownElapsed) {
    chime.lastRungAt = now;
    ring(chime);
  }
}

function startPhysicsLoop(chimes: Chime[]): void {
  let last = performance.now() / 1000;
  const tick = (): void => {
    const now = performance.now() / 1000;
    const dt = Math.min(now - last, 0.05);
    last = now;
    for (const chime of chimes) {
      stepPhysics(chime, dt, now);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

interface Drag {
  lastX: number;
  lastY: number;
  lastTime: number;
  dirX: number;
  strummed: Set<Chime>;
}

function chimeAtPoint(chimes: Chime[], clientX: number, clientY: number): Chime | undefined {
  const el = document.elementFromPoint(clientX, clientY);
  return chimes.find((chime) => chime.button === el);
}

// Press-and-drag is the main way to play: through the gaps it raises wind
// that sways and rings nearby chimes on its own (via stepPhysics above);
// dragging straight across a chime strums it immediately, on top of that.
function setupWind(field: HTMLElement, chimes: Chime[]): void {
  const drags = new Map<number, Drag>();

  field.addEventListener("pointerdown", (event) => {
    markInteracted();
    const strummed = new Set<Chime>();
    const initial = chimeAtPoint(chimes, event.clientX, event.clientY);
    if (initial) {
      // The chime button's own pointerdown handler already rang it.
      strummed.add(initial);
    }
    drags.set(event.pointerId, {
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now() / 1000,
      dirX: 1,
      strummed,
    });
  });

  field.addEventListener("pointermove", (event) => {
    const drag = drags.get(event.pointerId);
    if (!drag) {
      return;
    }
    const now = performance.now() / 1000;
    const dt = now - drag.lastTime;
    if (dt < 0.016) {
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const speed = Math.hypot(dx, dy) / Math.max(dt, 0.001);
    const strength = Math.min(speed / 1800, 1);
    if (dx !== 0) {
      drag.dirX = Math.sign(dx);
    }

    if (strength > 0.02) {
      const rect = field.getBoundingClientRect();
      const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
      addGust(xPercent, drag.dirX, strength);
    }

    const hit = chimeAtPoint(chimes, event.clientX, event.clientY);
    if (hit && !drag.strummed.has(hit)) {
      drag.strummed.add(hit);
      hit.angularVelocity += drag.dirX * Math.min(2 + strength * 4, 6);
      ring(hit);
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
  });

  const endDrag = (event: PointerEvent): void => {
    drags.delete(event.pointerId);
  };
  field.addEventListener("pointerup", endDrag);
  field.addEventListener("pointercancel", endDrag);
}

export function initChimes(root: HTMLElement): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".chime"));
  const chimes: Chime[] = buttons.map((button, index) => {
    const hanger = button.parentElement as HTMLElement;
    const x = parseFloat(hanger.style.getPropertyValue("--x"));
    const duration = durationForIndex(index, buttons.length);
    return {
      button,
      hanger,
      midi: Number(button.dataset.midi),
      duration,
      x,
      angle: 0,
      angularVelocity: 0,
      stiffness: 25 / duration,
      damping: 0.9 / duration,
      lastRungAt: -Infinity,
    };
  });

  // One chime starts with a gentle nudge, below ring velocity, so it's
  // visibly swaying the instant the page loads -- an invitation to try
  // dragging, without making any sound before the visitor acts themselves.
  const inviter = chimes[Math.floor(chimes.length / 2)];
  if (inviter) {
    inviter.angularVelocity = 0.9;
  }

  // `pointerdown` fires the instant a mouse/finger/pen touches down --
  // unlike `click`, which waits for release, and would otherwise delay the
  // sound by however long the press is held. Enter/Space still need their
  // own keydown handling since neither is a pointer event.
  for (const chime of chimes) {
    chime.button.addEventListener("pointerdown", () => {
      markInteracted();
      ring(chime);
    });
    chime.button.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        markInteracted();
        ring(chime);
      }
    });
  }

  const keyToChime = new Map<string, Chime>();
  for (const chime of chimes) {
    const key = chime.button.dataset.key;
    if (key) {
      keyToChime.set(key, chime);
    }
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      markInteracted();
      const dirX = event.key === "ArrowRight" ? 1 : -1;
      addGust(dirX === 1 ? 0 : 100, dirX, 0.7);
      return;
    }
    const chime = keyToChime.get(event.key.toLowerCase());
    if (chime) {
      markInteracted();
      ring(chime);
    }
  });

  const palette = root.querySelector<HTMLSelectElement>("#palette");
  if (palette) {
    const applyPalette = () => {
      setPaletteBrightness(palette.value === "bright" ? 1.4 : 0.7);
    };
    palette.addEventListener("change", applyPalette);
    applyPalette();
  }

  setupWind(root, chimes);
  startPhysicsLoop(chimes);
}
