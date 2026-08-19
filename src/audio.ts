// Created lazily, only from a real user-gesture handler (see chimes.ts) --
// that's what keeps the page silent on load, not just discipline: browsers
// enforce it via the autoplay-gesture policy too.
let ctx: AudioContext | null = null;
let unlocked = false;

// Chromium auto-suspends an AudioContext once its graph goes idle (no active
// nodes) to save power -- which happens every time a chime's decay finishes.
// Without this, the next press has to pay an async resume() round-trip
// before its scheduled notes actually start ticking, which is audible as a
// real gap on essentially every press, not just the first. A permanently
// running, silent node keeps the graph "hot" so that never happens again
// after the first unlock.
function keepGraphAlive(context: AudioContext): void {
  const silence = context.createGain();
  silence.gain.value = 0;
  silence.connect(context.destination);
  const heartbeat = context.createOscillator();
  heartbeat.frequency.value = 20;
  heartbeat.connect(silence);
  heartbeat.start();
}

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (!unlocked) {
    unlocked = true;
    void ctx.resume();
    keepGraphAlive(ctx);
  }
  return ctx;
}

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// The palette <select>'s mood: how much overtone color is mixed into the
// tone. Replaced with real per-material presets in a later step.
let brightness = 0.7;

export function setPaletteBrightness(value: number): void {
  brightness = value;
}

export function playChime(midi: number, durationSeconds: number): void {
  const audioCtx = getContext();
  const now = audioCtx.currentTime;
  const freq = midiToFrequency(midi);
  const stopAt = now + durationSeconds + 0.05;

  const envelope = audioCtx.createGain();
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.5, now + 0.003);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
  envelope.connect(audioCtx.destination);

  const fundamental = audioCtx.createOscillator();
  fundamental.type = "sine";
  fundamental.frequency.setValueAtTime(freq, now);
  fundamental.connect(envelope);

  // A slightly inharmonic partial, typical of a struck bar/tube, gives the
  // fundamental sine a chime-like color instead of a plain pure tone.
  const overtoneGain = audioCtx.createGain();
  overtoneGain.gain.setValueAtTime(0.18 * brightness, now);
  overtoneGain.connect(envelope);

  const overtone = audioCtx.createOscillator();
  overtone.type = "triangle";
  overtone.frequency.setValueAtTime(freq * 2.76, now);
  overtone.connect(overtoneGain);

  fundamental.start(now);
  overtone.start(now);
  fundamental.stop(stopAt);
  overtone.stop(stopAt);
}
