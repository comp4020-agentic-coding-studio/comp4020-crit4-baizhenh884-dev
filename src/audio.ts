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

// The palette <select>'s mood: an overall brightness multiplier on top of
// whatever a chime's material and strike velocity already decided.
let brightness = 0.7;

export function setPaletteBrightness(value: number): void {
  brightness = value;
}

// A short burst of noise, reused as the source for every strike's mallet
// tick -- one buffer, filtered differently per material, rather than
// synthesizing fresh noise per strike.
let noiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(audioCtx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const length = Math.floor(audioCtx.sampleRate * 0.08);
    noiseBuffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
  }
  return noiseBuffer;
}

// A small synthesized room, not a real recorded space -- an exponentially
// decaying noise burst through a convolver gives notes a touch of air
// without needing an impulse-response file. One shared instance: every
// note sends into it, nothing about it varies per strike.
let reverb: { convolver: ConvolverNode; send: GainNode } | null = null;

function getReverb(audioCtx: AudioContext): { convolver: ConvolverNode; send: GainNode } {
  if (!reverb) {
    const convolver = audioCtx.createConvolver();
    const length = Math.floor(audioCtx.sampleRate * 1.6);
    const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.5;
      }
    }
    convolver.buffer = impulse;
    convolver.connect(audioCtx.destination);

    const send = audioCtx.createGain();
    send.gain.value = 0.16;
    send.connect(convolver);

    reverb = { convolver, send };
  }
  return reverb;
}

interface Partial {
  // Multiple of the fundamental -- deliberately not a small integer, which
  // is what would make this sound like a piano string instead of a struck
  // bar. These ratios follow the classic clamped-free bending-mode series
  // real chimes/tubular bells actually ring with.
  ratio: number;
  amp: number;
  decayMult: number;
}

interface Material {
  partials: Partial[];
  decayScale: number;
  strikeFilterFreq: number;
  strikeFilterQ: number;
  detuneCents: number;
  brightnessBase: number;
}

// Three zones across the field, each a different physical voice -- moving
// along it should change the tone with no menu involved.
const MATERIALS: Record<"metal" | "bamboo" | "glass", Material> = {
  metal: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 1 },
      { ratio: 2.756, amp: 0.42, decayMult: 0.55 },
      { ratio: 5.404, amp: 0.22, decayMult: 0.32 },
      { ratio: 8.933, amp: 0.1, decayMult: 0.18 },
    ],
    decayScale: 1.5,
    strikeFilterFreq: 3200,
    strikeFilterQ: 0.6,
    detuneCents: 5,
    brightnessBase: 0.5,
  },
  bamboo: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 1 },
      { ratio: 2.4, amp: 0.28, decayMult: 0.45 },
      { ratio: 3.8, amp: 0.12, decayMult: 0.28 },
    ],
    decayScale: 0.6,
    strikeFilterFreq: 1200,
    strikeFilterQ: 0.45,
    detuneCents: 3,
    brightnessBase: 0.3,
  },
  glass: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 1 },
      { ratio: 2.0, amp: 0.35, decayMult: 0.5 },
      { ratio: 3.76, amp: 0.18, decayMult: 0.35 },
    ],
    decayScale: 1.0,
    strikeFilterFreq: 5200,
    strikeFilterQ: 0.9,
    detuneCents: 2.5,
    brightnessBase: 0.4,
  },
};

function materialForX(xPercent: number): Material {
  if (xPercent < 100 / 3) {
    return MATERIALS.metal;
  }
  if (xPercent < 200 / 3) {
    return MATERIALS.bamboo;
  }
  return MATERIALS.glass;
}

// velocity is 0-1: how hard/fast the strike was, from a tap, a strum, or the
// swing speed the wind gave a chime -- it sets both loudness and how much of
// the upper partial mix comes through, so a soft strike is quiet and mellow
// and a hard one is loud and bright, the same regardless of what caused it.
export function playChime(midi: number, durationSeconds: number, velocity = 0.55, xPercent = 50): void {
  const audioCtx = getContext();
  const now = audioCtx.currentTime;
  const freq = midiToFrequency(midi);
  const material = materialForX(xPercent);
  const v = Math.max(0, Math.min(velocity, 1));

  // Per-strike micro-variation -- so hitting the same chime twice never
  // sounds quite the same: a little detune, a few milliseconds of timing,
  // and a stretch or squeeze on how long it rings.
  const jitterDetune = (Math.random() - 0.5) * 6;
  const jitterDecay = 0.9 + Math.random() * 0.2;
  const jitterDelay = Math.random() * 0.004;

  const decaySeconds = durationSeconds * material.decayScale * jitterDecay;
  const stopAt = now + decaySeconds + 0.15;

  // Squaring velocity spreads the ends of the range apart instead of
  // scaling loudness/brightness linearly -- a soft strike should read as
  // clearly soft, not just a slightly quieter version of a hard one.
  const vCurve = v * v;

  const voice = audioCtx.createGain();
  voice.gain.value = 0.1 + vCurve * 0.75;
  voice.connect(audioCtx.destination);
  const { send } = getReverb(audioCtx);
  voice.connect(send);

  const brightnessMix = material.brightnessBase * (0.12 + vCurve * 1.6) * brightness;

  material.partials.forEach((partial, i) => {
    const partialGain = audioCtx.createGain();
    // The fundamental always carries the note; velocity/palette brightness
    // only changes how much of the overtone color rides on top of it.
    const peak = i === 0 ? 1 : partial.amp * brightnessMix;
    const attackAt = now + jitterDelay + 0.002 + i * 0.0015;
    partialGain.gain.setValueAtTime(0, now + jitterDelay);
    partialGain.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), attackAt);
    // Higher partials fade faster than the fundamental -- the shimmer of a
    // real struck bar/tube, where the ring settles into its lowest tone.
    const partialDecay = Math.max(0.08, decaySeconds * partial.decayMult);
    partialGain.gain.exponentialRampToValueAtTime(0.0001, attackAt + partialDecay);
    partialGain.connect(voice);

    const osc = audioCtx.createOscillator();
    osc.type = i === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(freq * partial.ratio, now);
    // Only the overtones get spread-detuned for shimmer; detuning the
    // fundamental itself would just make the note sound out of tune.
    osc.detune.setValueAtTime(i === 0 ? jitterDetune : jitterDetune + i * material.detuneCents * (i % 2 === 0 ? 1 : -1), now);
    osc.connect(partialGain);
    osc.start(now + jitterDelay);
    osc.stop(stopAt);
    osc.onended = () => {
      osc.disconnect();
      partialGain.disconnect();
    };
  });

  // A soft mallet tick, not a hard click -- filtered noise, gentle attack,
  // gone within tens of milliseconds, so the strike reads as touch rather
  // than impact.
  const strike = audioCtx.createBufferSource();
  strike.buffer = getNoiseBuffer(audioCtx);
  const strikeFilter = audioCtx.createBiquadFilter();
  strikeFilter.type = "bandpass";
  strikeFilter.frequency.value = material.strikeFilterFreq;
  strikeFilter.Q.value = material.strikeFilterQ;
  const strikeGain = audioCtx.createGain();
  const strikePeak = 0.015 + vCurve * 0.3;
  strikeGain.gain.setValueAtTime(0, now + jitterDelay);
  strikeGain.gain.linearRampToValueAtTime(strikePeak, now + jitterDelay + 0.006);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + jitterDelay + 0.05);
  strike.connect(strikeFilter);
  strikeFilter.connect(strikeGain);
  strikeGain.connect(voice);
  strike.start(now + jitterDelay);
  strike.stop(now + jitterDelay + 0.06);
  strike.onended = () => {
    strike.disconnect();
    strikeFilter.disconnect();
    strikeGain.disconnect();
  };

  window.setTimeout(() => {
    voice.disconnect();
  }, (decaySeconds + 0.25) * 1000);
}
