import { playChime, setPaletteBrightness } from "./audio";
import { addGust, windForceAt } from "./wind";
import { initWindVisuals } from "./visuals";

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

// A single throw: one gust, sweeping the whole field from a random side --
// not a toggle, so pressing the Wind button or spacebar again just throws
// another one.
function throwGust(): void {
  markInteracted();
  const dirX = Math.random() < 0.5 ? -1 : 1;
  addGust(dirX === 1 ? 0 : 100, dirX, 0.9);
}

// velocity is 0-1: how hard/fast this particular strike was. Taps and key
// presses have no motion to measure it from, so they default to a plain
// medium strike -- neither soft nor hard.
function ring(chime: Chime, velocity = 0.55): void {
  playChime(chime.midi, chime.duration, velocity, chime.x);
  chime.button.classList.add("ringing");
  window.setTimeout(() => {
    chime.button.classList.remove("ringing");
  }, chime.duration * 1000);
}

// How fast a chime has to be swinging before it counts as "struck" --
// crossing this is what turns wind into an actual ring.
const RING_VELOCITY = 1.6;
// A wind-driven ring's velocity maps the swing speed *above* RING_VELOCITY
// (a gust too gentle to reach it never rings at all) onto 0-1, so a gust
// that only just crosses the threshold rings soft and a strong one that
// swings the chime much faster rings hard -- the full range is reachable,
// not just its upper half.
const MAX_SWING_VELOCITY = RING_VELOCITY * 2.2;
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

  // CSS rotation is clockwise-positive, which for a top-pivoted hanger
  // swings the bottom *left* on a positive angle -- the opposite of the
  // "positive = pushed right" convention the wind force above uses, so the
  // physics angle is negated only here, at the point it becomes a render.
  chime.hanger.style.transform = `rotate(${-chime.angle}rad)`;

  const crossedThreshold = wasBelowThreshold && Math.abs(chime.angularVelocity) >= RING_VELOCITY;
  const cooldownElapsed = now - chime.lastRungAt > Math.max(0.15, chime.duration * 0.2);
  if (hasInteracted && crossedThreshold && cooldownElapsed) {
    chime.lastRungAt = now;
    const swing = Math.abs(chime.angularVelocity);
    const velocity = Math.max(0.05, Math.min(1, (swing - RING_VELOCITY) / (MAX_SWING_VELOCITY - RING_VELOCITY)));
    ring(chime, velocity);
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
  windBuild: number;
  strummed: Set<Chime>;
}

function chimeAtPoint(chimes: Chime[], clientX: number, clientY: number): Chime | undefined {
  const el = document.elementFromPoint(clientX, clientY);
  return chimes.find((chime) => chime.button === el);
}

// Below this drag speed (px/s), an air-drag builds no wind at all -- a
// quick flick barely registers. Above MAX_PUSH_SPEED it's already a full
// push. WIND_RAMP_SECONDS is how long a *sustained* push takes to approach
// full strength (and, using the same filter, how long it takes to ease back
// off) -- the "a bit of inertia" feel, and why a strong gust needs a longer
// drag rather than one fast swipe.
const MIN_PUSH_SPEED = 300;
const MAX_PUSH_SPEED = 2000;
const WIND_RAMP_SECONDS = 0.55;
const WIND_BUILD_FLOOR = 0.05;

// A strum's speed normalizes over its own, much lower range -- contact with
// a chime is a small, deliberate motion, not the sustained sweep a gust
// needs, so a drag across it barely reaches wind's MIN_PUSH_SPEED at all.
const MIN_STRUM_SPEED = 50;
const MAX_STRUM_SPEED = 1500;

// Press-and-drag is the main way to play: through the gaps it raises wind
// that builds up and sways/rings nearby chimes on its own (via stepPhysics
// above); dragging straight across a chime strums it instead -- immediate,
// on contact, regardless of how built-up the wind currently is.
function setupWind(field: HTMLElement, chimes: Chime[]): void {
  const drags = new Map<number, Drag>();

  field.addEventListener("pointerdown", (event) => {
    markInteracted();
    // Captures every later move/up for this pointer to `field`, even once
    // the cursor leaves it -- otherwise a drag released outside the field's
    // bounds never fires a pointerup here, and the stale entry left in
    // `drags` makes every later hover (no button held) look like a drag.
    field.setPointerCapture(event.pointerId);
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
      windBuild: 0,
      strummed,
    });
  });

  field.addEventListener("pointermove", (event) => {
    const drag = drags.get(event.pointerId);
    if (!drag) {
      return;
    }
    if (event.buttons === 0) {
      // The press ended without a pointerup reaching us -- treat it as
      // over rather than keep raising wind from a pointer that's lifted.
      drags.delete(event.pointerId);
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
    if (dx !== 0) {
      drag.dirX = Math.sign(dx);
    }

    const hit = chimeAtPoint(chimes, event.clientX, event.clientY);

    if (hit) {
      // Direct contact only ever rings the chime it touches -- it never
      // also raises wind, so the two gestures stay legible as separate
      // things. The strum's own speed (not wind's push-speed range) sets
      // how hard it rings: a slow drift across it is soft, a fast swipe hard.
      if (!drag.strummed.has(hit)) {
        drag.strummed.add(hit);
        const strumVelocity = Math.max(0.1, Math.min((speed - MIN_STRUM_SPEED) / (MAX_STRUM_SPEED - MIN_STRUM_SPEED), 1));
        hit.angularVelocity += drag.dirX * Math.min(2 + strumVelocity * 4, 6);
        ring(hit, strumVelocity);
      }
      // Let any wind already building settle back down while the pointer
      // is over a chime, rather than carrying it into the next gap.
      drag.windBuild += (0 - drag.windBuild) * Math.min(dt / WIND_RAMP_SECONDS, 1);
    } else {
      // How hard this particular instant is pushing, before any ramping --
      // fed through the ramp filter so the wind itself builds gradually.
      const instant = Math.max(0, Math.min((speed - MIN_PUSH_SPEED) / (MAX_PUSH_SPEED - MIN_PUSH_SPEED), 1));
      drag.windBuild += (instant - drag.windBuild) * Math.min(dt / WIND_RAMP_SECONDS, 1);

      if (drag.windBuild > WIND_BUILD_FLOOR) {
        const rect = field.getBoundingClientRect();
        const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
        addGust(xPercent, drag.dirX, drag.windBuild);
      }
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
  });

  const endDrag = (event: PointerEvent): void => {
    drags.delete(event.pointerId);
    if (field.hasPointerCapture(event.pointerId)) {
      field.releasePointerCapture(event.pointerId);
    }
  };
  field.addEventListener("pointerup", endDrag);
  field.addEventListener("pointercancel", endDrag);
}

export function initChimes(root: HTMLElement): void {
  const field = root.querySelector<HTMLElement>(".chime-field");
  if (!field) {
    return;
  }

  const buttons = Array.from(field.querySelectorAll<HTMLButtonElement>(".chime"));
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
    // Space throws a gust, same as the Wind button -- but not when a button
    // already has focus, since Space activating *that* button (a chime
    // ringing itself, or the Wind button's own click) is what should happen.
    if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      throwGust();
      return;
    }
    const chime = keyToChime.get(event.key.toLowerCase());
    if (chime) {
      markInteracted();
      ring(chime);
    }
  });

  const windButton = root.querySelector<HTMLButtonElement>("#wind-button");
  if (windButton) {
    windButton.addEventListener("click", throwGust);
  }

  const palette = root.querySelector<HTMLSelectElement>("#palette");
  if (palette) {
    const applyPalette = () => {
      setPaletteBrightness(palette.value === "bright" ? 1.4 : 0.7);
    };
    palette.addEventListener("change", applyPalette);
    applyPalette();
  }

  const canvas = field.querySelector<HTMLCanvasElement>("#wind-canvas");
  if (canvas) {
    initWindVisuals(field, canvas);
  }

  setupWind(field, chimes);
  startPhysicsLoop(chimes);
}
