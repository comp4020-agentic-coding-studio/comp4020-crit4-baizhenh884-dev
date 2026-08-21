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
  // Amplitude of the fundamental itself (usually full, 1) -- turning this
  // down lets the overtone mix read louder relative to it, for a voice that
  // leans on its upper partials rather than its low end.
  fundamentalGain: number;
  // How fast the mallet-tick transient ramps to its peak -- lower is a
  // sharper, snappier onset; higher is a softer, duller one.
  strikeAttackSeconds: number;
  // How long the mallet-tick takes to decay away after its peak -- a real
  // knob on the transient's own length, not just its loudness or filtering.
  strikeDecaySeconds: number;
  // "bandpass" (the default mallet tick) vs "highpass" -- a highpass reads
  // as filtered noise/sizzle rather than a resonant knock, for a material
  // whose strike should sound like a click, not a tap.
  strikeFilterType: BiquadFilterType;
  // Octave (or other) shift applied on top of the chime's tuned pitch --
  // 1 for every material that should sound at the instrument's actual tuning.
  pitchMultiplier: number;
  // Highpass cutoff over the whole voice, rolling off any low-end mud below
  // it. 0 disables it entirely (no filter node added), which is what every
  // material used before this existed.
  voiceHighpassFreq: number;
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
    fundamentalGain: 1,
    strikeAttackSeconds: 0.006,
    strikeDecaySeconds: 0.044,
    strikeFilterType: "bandpass",
    pitchMultiplier: 1,
    voiceHighpassFreq: 0,
  },
  // A dead, muffled, hollow knock -- barely any tone at all (a fundamental
  // that fades fast and a second partial that's all but gone), a hard, low
  // lowpass so no highs survive, and a dark, dull strike, so it lands as a
  // knuckle-on-wood "tok" with no ring left in it.
  bamboo: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 0.32 },
      { ratio: 2.4, amp: 0.04, decayMult: 0.06 },
    ],
    decayScale: 0.18,
    strikeFilterFreq: 300,
    strikeFilterQ: 0.5,
    strikeGainMult: 2.6,
    voiceFilterFreq: 850,
    reverbSendMult: 0.1,
    detuneCents: 1.2,
    brightnessBase: 0.06,
    fundamentalGain: 1,
    strikeAttackSeconds: 0.006,
    strikeDecaySeconds: 0.044,
    strikeFilterType: "bandpass",
    pitchMultiplier: 1,
    voiceHighpassFreq: 0,
  },
  // A wine-glass "ting", not a bell: voiced a full octave above the
  // instrument's actual tuning (pitchMultiplier), reduced to a near-pure
  // sine plus two clean high harmonics instead of a dense inharmonic stack,
  // a highpassed voice with no low end left in it, a near-instant attack
  // into a short bright decay, and a few milliseconds of high-passed noise
  // as the "tick" of nail on glass right at the onset.
  glass: {
    partials: [
      { ratio: 1, amp: 1, decayMult: 0.55 },
      { ratio: 3, amp: 0.22, decayMult: 0.22 },
      { ratio: 6, amp: 0.08, decayMult: 0.1 },
    ],
    decayScale: 0.6,
    strikeFilterFreq: 10000,
    strikeFilterQ: 0.9,
    strikeGainMult: 1.4,
    voiceFilterFreq: 16000,
    reverbSendMult: 0.22,
    detuneCents: 1,
    brightnessBase: 0.85,
    fundamentalGain: 1,
    strikeAttackSeconds: 0.0008,
    strikeDecaySeconds: 0.012,
    strikeFilterType: "highpass",
    pitchMultiplier: 2,
    voiceHighpassFreq: 400,
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
  const material = currentMaterial;
  const freq = midiToFrequency(midi) * material.pitchMultiplier;
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

  // Only added when a material actually wants it (glass), so materials that
  // didn't ask for one get the exact same graph as before it existed.
  let voiceHighpass: BiquadFilterNode | null = null;
  let voiceOut: AudioNode = voiceFilter;
  if (material.voiceHighpassFreq > 0) {
    voiceHighpass = audioCtx.createBiquadFilter();
    voiceHighpass.type = "highpass";
    voiceHighpass.frequency.value = material.voiceHighpassFreq;
    voiceFilter.connect(voiceHighpass);
    voiceOut = voiceHighpass;
  }
  voiceOut.connect(audioCtx.destination);

  const { send } = getReverb(audioCtx);
  const reverbSend = audioCtx.createGain();
  reverbSend.gain.value = material.reverbSendMult;
  voiceOut.connect(reverbSend);
  reverbSend.connect(send);

  const brightnessMix = material.brightnessBase * (0.12 + vCurve * 1.6);

  material.partials.forEach((partial, i) => {
    const partialGain = audioCtx.createGain();
    // The fundamental always carries the note; velocity/material brightness
    // only changes how much of the overtone color rides on top of it.
    const peak = i === 0 ? material.fundamentalGain : partial.amp * brightnessMix;
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
  strikeFilter.type = material.strikeFilterType;
  strikeFilter.frequency.value = material.strikeFilterFreq;
  strikeFilter.Q.value = material.strikeFilterQ;
  const strikeGain = audioCtx.createGain();
  const strikePeak = (0.015 + vCurve * 0.3) * material.strikeGainMult;
  const strikeAttackAt = now + jitterDelay + material.strikeAttackSeconds;
  const strikeSilentAt = strikeAttackAt + material.strikeDecaySeconds;
  strikeGain.gain.setValueAtTime(0, now + jitterDelay);
  strikeGain.gain.linearRampToValueAtTime(strikePeak, strikeAttackAt);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, strikeSilentAt);
  strike.connect(strikeFilter);
  strikeFilter.connect(strikeGain);
  strikeGain.connect(voice);
  strike.start(now + jitterDelay);
  strike.stop(strikeSilentAt + 0.01);
  strike.onended = () => {
    strike.disconnect();
    strikeFilter.disconnect();
    strikeGain.disconnect();
  };

  window.setTimeout(() => {
    voice.disconnect();
    voiceFilter.disconnect();
    voiceHighpass?.disconnect();
    reverbSend.disconnect();
  }, (decaySeconds + 0.25) * 1000);
}
