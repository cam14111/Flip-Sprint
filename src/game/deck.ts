// The 94-card deck, and the deterministic shuffle every device must agree on.

import {
  BONUS_10,
  BONUS_2,
  BONUS_4,
  BONUS_6,
  BONUS_8,
  BURST,
  Card,
  CardCode,
  MAX_NUMBER,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "./types";

/** Copies of each number card: one `0`, one `1`, two `2` … twelve `12`. */
export const numberCopies = (value: number): number => (value === 0 ? 1 : value);

export const MODIFIER_CODES: CardCode[] = [
  BONUS_2,
  BONUS_4,
  BONUS_6,
  BONUS_8,
  BONUS_10,
  TURBO,
];

/** Three of each action card. */
export const ACTION_CODES: CardCode[] = [WHISTLE, BURST, SECOND_WIND];
export const ACTION_COPIES = 3;

/** 79 number cards + 6 modifiers + 9 action cards. */
export const DECK_SIZE = 94;

/** The deck's full composition, as a code -> count map. */
export const deckComposition = (): Map<CardCode, number> => {
  const counts = new Map<CardCode, number>();
  for (let v = 0; v <= MAX_NUMBER; v++) counts.set(v, numberCopies(v));
  for (const code of MODIFIER_CODES) counts.set(code, 1);
  for (const code of ACTION_CODES) counts.set(code, ACTION_COPIES);
  return counts;
};

/** A fresh, ordered deck (before shuffling). */
export const buildDeck = (): CardCode[] => {
  const codes: CardCode[] = [];
  for (const [code, count] of deckComposition()) {
    for (let i = 0; i < count; i++) codes.push(code);
  }
  return codes;
};

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * xorshift32. Small, fast, and — crucially — reproducible from a seed across
 * every JavaScript engine, which is what keeps an online race in lockstep when
 * the pile has to be reshuffled mid-round.
 */
export const nextRandom = (state: number): { value: number; state: number } => {
  let x = state >>> 0;
  if (x === 0) x = 0x9e3779b9; // a zero state would be absorbing
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { value: x / 0x100000000, state: x };
};

export const randomSeed = (): number => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] >>> 0 || 1;
};

/** Fisher-Yates driven by the in-state RNG, so the result is reproducible. */
export const shuffle = <T>(
  items: readonly T[],
  seed: number
): { items: T[]; state: number } => {
  const out = items.slice();
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextRandom(state);
    state = r.state;
    const j = Math.floor(r.value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { items: out, state };
};

/**
 * Shuffles a fresh deck into the dealt order. Card ids double as online refs
 * ("d/0", "d/1", …), which keeps replay bookkeeping trivial: the k-th card
 * drawn in a race is always `d/k`.
 */
export const dealDeck = (seed: number): { cards: Card[]; state: number } => {
  const { items, state } = shuffle(buildDeck(), seed);
  return {
    cards: items.map((code, i) => ({ id: `d/${i}`, code })),
    state,
  };
};
