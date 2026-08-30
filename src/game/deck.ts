// The two decks, and the deterministic shuffle every device must agree on.

import {
  BONUS_10,
  BONUS_2,
  BONUS_4,
  BONUS_6,
  BONUS_8,
  BURST,
  Card,
  CardCode,
  COUP_DE_BARRE,
  DOSSARD_FETICHE,
  DRAFT,
  FAUX_DEPART,
  HIGHEST_NUMBER,
  LAST_STRAIGHT,
  LE_MUR,
  MAX_NUMBER,
  PENALTY_10,
  PENALTY_2,
  PENALTY_4,
  PENALTY_6,
  PENALTY_8,
  RELAY,
  RulesetId,
  SECOND_WIND,
  SQUALL,
  STUMBLE,
  TURBO,
  WHISTLE,
} from "./types";

/** Copies of each number card: one `0`, one `1`, two `2` … *N* of *N*. */
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

/** One of each penalty, and the Coup de barre. */
export const PENALTY_CODES: CardCode[] = [
  PENALTY_2,
  PENALTY_4,
  PENALTY_6,
  PENALTY_8,
  PENALTY_10,
  COUP_DE_BARRE,
];

/** Two of each nasty action. */
export const COUPS_BAS_ACTION_CODES: CardCode[] = [
  LAST_STRAIGHT,
  SQUALL,
  RELAY,
  DRAFT,
  STUMBLE,
];
export const COUPS_BAS_ACTION_COPIES = 2;

/**
 * classique — 79 number cards + 6 modifiers + 9 action cards.
 * coupsbas  — 92 number cards + 6 penalties + 10 action cards.
 */
export const DECK_SIZE: Record<RulesetId, number> = {
  classique: 94,
  coupsbas: 108,
};

/** Highest number card in each deck: Coups bas adds thirteen 13s. */
export const TOP_NUMBER: Record<RulesetId, number> = {
  classique: MAX_NUMBER,
  coupsbas: HIGHEST_NUMBER,
};

/**
 * The deck's full composition, as a code -> count map.
 *
 * In Coups bas three of the 92 number cards are singular: the lone 0 IS the
 * Faux départ, one of the seven 7s is Le Mur, and one of the thirteen 13s is
 * the Dossard fétiche. They are drawn from the same allowance, so the count
 * stays 92 — a plain 7 simply has six copies instead of seven.
 */
export const deckComposition = (
  ruleset: RulesetId = "classique"
): Map<CardCode, number> => {
  const counts = new Map<CardCode, number>();
  for (let v = 0; v <= TOP_NUMBER[ruleset]; v++) counts.set(v, numberCopies(v));

  if (ruleset === "classique") {
    for (const code of MODIFIER_CODES) counts.set(code, 1);
    for (const code of ACTION_CODES) counts.set(code, ACTION_COPIES);
    return counts;
  }

  counts.set(0, 0);
  counts.set(FAUX_DEPART, 1);
  counts.set(7, numberCopies(7) - 1);
  counts.set(LE_MUR, 1);
  counts.set(13, numberCopies(13) - 1);
  counts.set(DOSSARD_FETICHE, 1);
  for (const code of PENALTY_CODES) counts.set(code, 1);
  for (const code of COUPS_BAS_ACTION_CODES) {
    counts.set(code, COUPS_BAS_ACTION_COPIES);
  }
  return counts;
};

/** A fresh, ordered deck (before shuffling). */
export const buildDeck = (ruleset: RulesetId = "classique"): CardCode[] => {
  const codes: CardCode[] = [];
  for (const [code, count] of deckComposition(ruleset)) {
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
export const dealDeck = (
  seed: number,
  ruleset: RulesetId = "classique"
): { cards: Card[]; state: number } => {
  const { items, state } = shuffle(buildDeck(ruleset), seed);
  return {
    cards: items.map((code, i) => ({ id: `d/${i}`, code })),
    state,
  };
};
