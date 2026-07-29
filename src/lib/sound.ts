// Synthesised sound. Not a single audio file ships: every effect is generated
// on the fly with the Web Audio API, so the offline bundle stays weightless and
// nothing is ever fetched.
//
// The palette follows the game's language — a card lands with a tick, a cramp
// buzzes downward, a sprint parfait climbs.

export type SoundName =
  | "draw"
  | "safe"
  | "bonus"
  | "turbo"
  | "cramp"
  | "whistle"
  | "burst"
  | "perfect"
  | "bank"
  | "turn"
  | "button";

let ctx: AudioContext | null = null;
let enabled = true;

export const setSoundEnabled = (value: boolean): void => {
  enabled = value;
};

const getCtx = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};

/** Call once from a user gesture to unlock audio on mobile browsers. */
export const primeAudio = (): void => {
  getCtx();
};

interface ToneOptions {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  glideTo?: number;
  delay?: number;
}

const tone = (audio: AudioContext, opts: ToneOptions): void => {
  const {
    freq,
    duration,
    type = "sine",
    gain = 0.07,
    attack = 0.005,
    glideTo,
    delay = 0,
  } = opts;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) {
    osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
  }
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
};

/** A short filtered noise burst — the texture behind a cramp. */
const noise = (
  audio: AudioContext,
  duration: number,
  gain = 0.05,
  delay = 0
): void => {
  const frames = Math.floor(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const env = audio.createGain();
  env.gain.value = gain;
  src.connect(filter);
  filter.connect(env);
  env.connect(audio.destination);
  src.start(audio.currentTime + delay);
};

const chord = (
  audio: AudioContext,
  freqs: number[],
  duration: number,
  gain: number,
  stagger = 0
): void => {
  freqs.forEach((freq, i) =>
    tone(audio, {
      freq,
      duration,
      type: "triangle",
      gain,
      delay: i * stagger,
    })
  );
};

export const playSound = (name: SoundName): void => {
  if (!enabled) return;
  const audio = getCtx();
  if (!audio) return;

  switch (name) {
    case "draw": // a card slides out of the deck
      tone(audio, { freq: 320, glideTo: 470, duration: 0.1, gain: 0.05 });
      break;
    case "safe": // a number lands cleanly in the lane
      tone(audio, { freq: 620, duration: 0.09, type: "triangle", gain: 0.05 });
      break;
    case "bonus":
      chord(audio, [700, 1050], 0.14, 0.045, 0.05);
      break;
    case "turbo":
      tone(audio, {
        freq: 420,
        glideTo: 1200,
        duration: 0.3,
        type: "sawtooth",
        gain: 0.045,
      });
      break;
    case "cramp": // the run ends badly
      tone(audio, {
        freq: 300,
        glideTo: 90,
        duration: 0.42,
        type: "sawtooth",
        gain: 0.07,
      });
      noise(audio, 0.32, 0.05);
      break;
    case "whistle": // two-tone referee call
      tone(audio, { freq: 1180, duration: 0.13, type: "square", gain: 0.035 });
      tone(audio, {
        freq: 1560,
        duration: 0.16,
        type: "square",
        gain: 0.035,
        delay: 0.11,
      });
      break;
    case "burst": // three quick impacts
      [520, 620, 740].forEach((freq, i) =>
        tone(audio, {
          freq,
          duration: 0.09,
          type: "triangle",
          gain: 0.055,
          delay: i * 0.09,
        })
      );
      break;
    case "perfect": // seven unique numbers — climb and shine
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) =>
        tone(audio, {
          freq,
          duration: 0.26,
          type: "triangle",
          gain: 0.06,
          delay: i * 0.09,
        })
      );
      break;
    case "bank": // catching your breath, points secured
      chord(audio, [392, 494, 587], 0.34, 0.045, 0.02);
      break;
    case "turn":
      tone(audio, { freq: 700, duration: 0.06, gain: 0.035 });
      break;
    case "button":
      tone(audio, { freq: 500, duration: 0.045, type: "square", gain: 0.028 });
      break;
  }
};
