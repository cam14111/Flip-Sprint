// Core domain types for the Flip Sprint engine.
//
// The engine is deliberately framework-agnostic and pure: every transition is
// `(state, action) -> state`, with no React, no timers, no I/O and no ambient
// randomness (the RNG seed lives in the state). That is what makes the rules
// fully unit-testable AND what lets every device in an online race replay the
// same action log and land on a byte-identical state.

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * A card is encoded as a single small integer. The compact numeric form is not
 * cosmetic: it travels inside online actions and the Realtime Database rules
 * compare it against the secret deal, and that rule language only handles
 * primitives.
 *
 *    0..12   number cards (their own value)
 *   20..24   Bonus +2, +4, +6, +8, +10
 *   25       Turbo (x2)
 *   30       Coup de sifflet  (the target banks and leaves the race)
 *   31       Rafale           (the target must take three cards in a row)
 *   32       Second souffle   (cancels one duplicate)
 */
export type CardCode = number;

export const BONUS_2 = 20;
export const BONUS_4 = 21;
export const BONUS_6 = 22;
export const BONUS_8 = 23;
export const BONUS_10 = 24;
export const TURBO = 25;
export const WHISTLE = 30;
export const BURST = 31;
export const SECOND_WIND = 32;

/** Highest number card. Number card *N* exists in *N* copies (except 0: one). */
export const MAX_NUMBER = 12;

/** Unique number cards needed for a "Sprint parfait". */
export const PERFECT_COUNT = 7;

/** Points awarded on top of the lane for a Sprint parfait. */
export const PERFECT_BONUS = 15;

/** Cards drawn by the target of a Rafale. */
export const BURST_SIZE = 3;

export const isNumberCard = (c: CardCode): boolean => c >= 0 && c <= MAX_NUMBER;
export const isBonusCard = (c: CardCode): boolean => c >= BONUS_2 && c <= BONUS_10;
export const isModifierCard = (c: CardCode): boolean => isBonusCard(c) || c === TURBO;
export const isActionCard = (c: CardCode): boolean =>
  c === WHISTLE || c === BURST || c === SECOND_WIND;

/** Point value added by a Bonus card (+2 … +10). */
export const bonusValue = (c: CardCode): number => (c - BONUS_2) * 2 + 2;

/** A dealt card. `id` is its position in the deal ("d/17") — also its online ref. */
export interface Card {
  id: string;
  code: CardCode;
}

// ---------------------------------------------------------------------------
// Runners (players)
// ---------------------------------------------------------------------------

/**
 * "running"  — still in the race, may accelerate or catch their breath
 * "banked"   — chose to stop ("Souffler"); keeps the lane's points
 * "whistled" — stopped by someone's Coup de sifflet; keeps the points too
 * "cramped"  — drew a duplicate ("Crampe !"); scores zero this race
 */
export type RunnerStatus = "running" | "banked" | "whistled" | "cramped";

export interface RunnerState {
  id: string;
  name: string;
  isAI: boolean;
  /**
   * Cards collected this race, in draw order (number and modifier cards).
   * Real card objects rather than derived values: it keeps card conservation
   * exact — every one of the 94 cards is always in exactly one place — and
   * gives the UI a stable key per card.
   */
  lane: Card[];
  /** The Second souffle in hand, usable once to cancel a duplicate. */
  secondWind: Card | null;
  status: RunnerStatus;
  /** Reached seven unique numbers — ends the race for everyone. */
  perfect: boolean;
  /** Has taken a card on their own turn this race (the opening deal). */
  opened: boolean;
  totalScore: number;
  lastRoundScore: number;
  roundScores: number[];
  /**
   * The lane as it stood when the last race was scored. The cards themselves
   * have gone to the discard by then, so the end-of-race recap reads from this
   * snapshot (codes only — no card identity, so nothing is double-counted).
   */
  lastLane: CardCode[];
  /**
   * Left the game entirely (online forfeit or exclusion). Out runners are
   * skipped by the rotation and excluded from scoring; their total freezes.
   */
  out?: boolean;
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/**
 * "solo"   — one human against AI runners
 * "local"  — several humans sharing one device (nothing is hidden, so there is
 *            no hand-off screen to manage)
 * "online" — humans on their own devices, state projected from a shared log
 */
export type GameMode = "solo" | "local" | "online";

export type Difficulty = "easy" | "normal" | "hard";

/**
 * "draw"      — the actor MUST take a card (opening deal, or mid-Rafale)
 * "decide"    — the actor may accelerate or catch their breath
 * "targeting" — the actor must hand out an action card they just drew
 * "roundOver" — the race is scored
 * "gameOver"  — the finish line was crossed
 */
export const ALL_PHASES = [
  "draw",
  "decide",
  "targeting",
  "roundOver",
  "gameOver",
] as const;

export type GamePhase = (typeof ALL_PHASES)[number];

/** An action card waiting for its target to be chosen. */
export interface PendingAssign {
  card: Card;
  /**
   * True when the card was set aside during a Rafale and is only being handed
   * out now that the Rafale is over (drives the wording in the UI).
   */
  deferred: boolean;
}

export interface GameState {
  mode: GameMode;
  players: RunnerState[];
  /** Whose turn it is in the table rotation. */
  turnSeat: number;
  /**
   * Who must act right now. This is NOT always `turnSeat`: a Rafale hands the
   * initiative to its target for three cards, and the assignment of any action
   * card set aside during that Rafale is made by the target too. Everything —
   * engine, wire protocol and database rules — keys off `actor`.
   */
  actor: number;
  phase: GamePhase;
  /** Cards left to take in the Rafale being resolved (0 = not in a Rafale). */
  burstLeft: number;
  /** Action cards drawn during a Rafale, to hand out once it ends, in order. */
  deferred: Card[];
  /** Runners queued to be bursted, once every pending assignment is done. */
  burstQueue: number[];
  /** The action card whose target the actor must choose (phase "targeting"). */
  pendingAssign: PendingAssign | null;
  deck: Card[];
  discard: Card[];
  /** Race counter within the game (1-based). */
  round: number;
  /** Total at which the finish line is crossed. */
  scoreLimit: number;
  /** "Éclair" mode: stop after this many races instead. null = score-based. */
  roundLimit: number | null;
  difficulty: Difficulty;
  /** Notable events from the last transition, for toasts, sounds, animations. */
  events: GameEvent[];
  /** RNG state, kept in-state so transitions stay pure and reproducible. */
  rngState: number;
}

export type GameEvent =
  | { type: "drew"; seat: number; code: CardCode }
  | { type: "bonus"; seat: number; value: number }
  | { type: "turbo"; seat: number }
  | { type: "secondWindGained"; seat: number }
  | { type: "secondWindUsed"; seat: number; value: number }
  | { type: "secondWindPassed"; from: number; to: number }
  | { type: "secondWindDropped"; seat: number }
  | { type: "cramp"; seat: number; value: number }
  | { type: "perfect"; seat: number }
  | { type: "banked"; seat: number }
  | { type: "whistled"; seat: number; by: number }
  | { type: "burstStart"; seat: number; by: number }
  | { type: "deferredDropped"; seat: number; count: number }
  | { type: "reshuffle" }
  | { type: "forfeit"; seat: number }
  | { type: "roundOver"; scores: number[] }
  | { type: "gameOver"; winner: number };

export type GameAction =
  | { type: "hit" } // Accélérer
  | { type: "stay" } // Souffler
  | { type: "assign"; target: number }; // hand out an action card
