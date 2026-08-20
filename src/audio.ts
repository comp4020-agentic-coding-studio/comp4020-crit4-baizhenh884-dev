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
  // How loud the mallet-tick transient is relative to the tonal partials --
  // a knocking material (bamboo) leans on this far more than a ringing one.
  strikeGainMult: number;
  // Lowpass cutoff over the whole voice (tone + strike). A real ceiling on
  // brightness that the per-partial amps can't fake: bamboo's hollow, muffled
  // knock needs the high end gone entirely, not just quieter.
  voiceFilterFreq: number;
  reverbSendMult: number;
  detuneCents: number;
  brightnessBase: number;
}

// Three whole-instrument voices, switched together via setMaterial -- not
// picked by position, so every chime always shares the same physical voice.
// Deliberately built to be far apart on every axis (partial count/spacing,
// decay length, strike character, filtering) rather than just retuning one
// knob each, since "clearly a different material" is the whole point.
const MATERIALS: Record<"metal" | "bamboo" | "glass", Material> = {
  // Rich, resonant metallic ring: a dense inharmonic partial stack (real
  // bell/tubular-bell bending-mode ratios) that decays slowly, so it has
  // more body and a longer sustain than glass's single pure ting.
  metal: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 1 },
      { ratio: 2.756, amp: 0.48, decayMult: 0.8 },
      { ratio: 4.516, amp: 0.3, decayMult: 0.6 },
      { ratio: 5.404, amp: 0.22, decayMult: 0.45 },
      { ratio: 8.933, amp: 0.13, decayMult: 0.3 },
    ],
    decayScale: 2.1,
    strikeFilterFreq: 3400,
    strikeFilterQ: 0.7,
    strikeGainMult: 1,
    voiceFilterFreq: 15000,
    reverbSendMult: 1.5,
    detuneCents: 6,
    brightnessBase: 0.55,
  },
  // A hollow, dry, woody knock rather than a ring: only the fundamental and
  // one fast-dying inharmonic partial, a short overall decay, a low-pitched
  // "tok" transient that dominates over the (barely-there) tone, and a
  // lowpass that removes the high end a ring would otherwise have.
  bamboo: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 0.7 },
      { ratio: 2.4, amp: 0.1, decayMult: 0.16 },
    ],
    decayScale: 0.32,
    strikeFilterFreq: 420,
    strikeFilterQ: 0.7,
    strikeGainMult: 2.4,
    voiceFilterFreq: 1700,
    reverbSendMult: 0.25,
    detuneCents: 1.5,
    brightnessBase: 0.15,
  },
  // Bright, pure, crisp: a clean high "ting" -- fewer partials than metal,
  // spaced for a delicate high shimmer rather than metal's dense buzz, with
  // a medium decay (shorter than metal's long sustain, not as clipped as
  // bamboo's knock) and a tight, high-pitched strike transient.
  glass: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 1 },
      { ratio: 2.0, amp: 0.3, decayMult: 0.6 },
      { ratio: 3.76, amp: 0.16, decayMult: 0.42 },
      { ratio: 5.0, amp: 0.07, decayMult: 0.26 },
    ],
    decayScale: 1.05,
    strikeFilterFreq: 6000,
    strikeFilterQ: 1.1,
    strikeGainMult: 1,
    voiceFilterFreq: 15000,
    reverbSendMult: 0.9,
    detuneCents: 2,
    brightnessBase: 0.65,
  },
};

// One material at a time, shared by every chime -- switched from the
// keyboard (Q/W/E), not derived from a chime's position, so the whole
// instrument's voice changes together instead of zone by zone.
let currentMaterial: Material = MATERIALS.metal;

export function setMaterial(key: keyof typeof MATERIALS): void {
  currentMaterial = MATERIALS[key];
}

// velocity is 0-1: how hard/fast the strike was, from a tap, a strum, or the
// swing speed the wind gave a chime -- it sets both loudness and how much of
// the upper partial mix comes through, so a soft strike is quiet and mellow
// and a hard one is loud and bright, the same regardless of what caused it.
export function playChime(midi: number, durationSeconds: number, velocity = 0.55): void {
  const audioCtx = getContext();
  const now = audioCtx.currentTime;
  const freq = midiToFrequency(midi);
  const material = currentMaterial;
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

  // A hard ceiling on brightness that per-partial amps can't fake -- bamboo's
  // muffled knock needs the high end actually gone, not just quieter.
  const voiceFilter = audioCtx.createBiquadFilter();
  voiceFilter.type = "lowpass";
  voiceFilter.frequency.value = material.voiceFilterFreq;
  voice.connect(voiceFilter);
  voiceFilter.connect(audioCtx.destination);

  const { send } = getReverb(audioCtx);
  const reverbSend = audioCtx.createGain();
  reverbSend.gain.value = material.reverbSendMult;
  voiceFilter.connect(reverbSend);
  reverbSend.connect(send);

  const brightnessMix = material.brightnessBase * (0.12 + vCurve * 1.6);

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
  const strikePeak = (0.015 + vCurve * 0.3) * material.strikeGainMult;
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
    voiceFilter.disconnect();
    reverbSend.disconnect();
  }, (decaySeconds + 0.25) * 1000);
}
