// Wire protocol for online races (2 to 8 runners).
//
// The whole design rests on one idea: every device replays the same append-only
// action log through the same pure engine, so their GameStates — and therefore
// every score, animation and turn change — are derived from identical inputs
// and cannot drift.
//
// Flip Sprint turns every card face up the moment it is drawn, so the only
// secret in the game is the ORDER OF THE DECK. That makes this protocol far
// simpler than a game with private hands: there are no per-seat secrets, no
// end-of-race reveal handshake, and nothing to disclose except the one card
// being taken. It lives in `secrets/{code}/{course}/d/{k}`, which no client can
// read wholesale; a value only becomes public embedded in a `hit` action, and
// the database rules check that it matches the secret.
//
// Numbers vs strings on the wire: any seat index the *database rules* have to
// splice into a path (`state.actor`, an action's `seat`, a result's `by`)
// travels as a string ("0".."7"), because the rules language can only
// concatenate strings. TypeScript keeps seats as numbers and converts at the
// read/write boundary.

import { GamePhase, RulesetId } from "@/game/types";

export type Seat = number;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const wireSeat = (seat: Seat): string => String(seat);

export const parseSeat = (value: unknown): Seat | null => {
  const n =
    typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isInteger(n) && n >= 0 && n < MAX_PLAYERS ? n : null;
};

// ---------------------------------------------------------------------------
// Game codes
// ---------------------------------------------------------------------------

/** Unambiguous alphabet: no O/0, I/1/L or U/V confusion. 28^6 ≈ 4.8e8 codes. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXZ";
export const CODE_LENGTH = 6;

export const randomGameCode = (): string => {
  const bytes = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
};

/**
 * Uppercases and strips separators, so a pasted or typed code is forgiving.
 *
 * Note what this does *not* do: map O to 0 or I to 1. That reflex is wrong
 * here — neither 0 nor 1 is in the alphabet, so "correcting" a character would
 * turn a valid code into an invalid one. The alphabet avoids the confusable
 * pairs in the first place, which is the whole point of choosing it.
 */
export const normalizeGameCode = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const isValidGameCode = (code: string): boolean =>
  code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

// ---------------------------------------------------------------------------
// Card references
// ---------------------------------------------------------------------------

/** The k-th card of a course's deck. Doubles as the engine's card id. */
export const deckRef = (k: number): string => `d/${k}`;

export const parseDeckRef = (ref: string): number | null => {
  const m = /^d\/(\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type OnlineActionType =
  | "hit" // take the next card and turn it over
  | "stay" // catch your breath, bank the lane
  | "assign" // hand out the action card just drawn
  | "pick" // point at a card in a lane (Coups bas)
  | "forfeit"; // leave the game (voluntarily, or excluded while absent)

export interface OnlineAction {
  /**
   * For play actions: the acting seat, which is always `state.actor` — note
   * that during a Rafale this is NOT the seat whose turn it is. For "forfeit":
   * the seat leaving, written either by that player or, when they are absent,
   * by the actor on everyone's behalf.
   */
  seat: Seat;
  type: OnlineActionType;
  /**
   * For "hit": the secret ref this action makes public — the card being taken.
   * For "pick": the card being pointed at, named by the id it was dealt under.
   * That card is already face up in a lane, so naming it reveals no secret.
   */
  ref?: string;
  /** The revealed card code (must equal the secret at `ref`). */
  value?: number;
  /** Seat receiving the action card, for "assign". */
  target?: number;
  /** Client timestamp, display only. */
  at?: number | object;
}

/** An action as stored in the database (seats as strings, for the rules). */
export interface WireAction {
  seat: string;
  type: OnlineActionType;
  ref?: string;
  value?: number;
  target?: string;
  at?: number | object;
}

export const toWireAction = (action: OnlineAction): WireAction => {
  const wire: WireAction = { seat: wireSeat(action.seat), type: action.type };
  if (action.ref !== undefined) wire.ref = action.ref;
  if (action.value !== undefined) wire.value = action.value;
  if (action.target !== undefined) wire.target = wireSeat(action.target);
  if (action.at !== undefined) wire.at = action.at;
  return wire;
};

export const fromWireAction = (wire: WireAction): OnlineAction | null => {
  const seat = parseSeat(wire.seat);
  if (seat === null) return null;
  const action: OnlineAction = { seat, type: wire.type };
  if (wire.ref !== undefined) action.ref = wire.ref;
  if (wire.value !== undefined) action.value = wire.value;
  if (wire.target !== undefined) {
    const target = parseSeat(wire.target);
    if (target === null) return null;
    action.target = target;
  }
  return action;
};

/** Action keys are zero-padded so the database's key order is play order. */
export const actionKey = (n: number): string => `a${String(n).padStart(4, "0")}`;

export const actionNumber = (key: string): number => Number(key.slice(1));

export const courseKey = (n: number): string => `c${n}`;

export const courseNumber = (key: string): number => Number(key.slice(1));

// ---------------------------------------------------------------------------
// Database shapes (types only — paths are built in client.ts)
// ---------------------------------------------------------------------------

export interface LobbyInfo {
  hostName: string;
  scoreLimit: number;
  /** null when the game runs to a score rather than a number of races. */
  roundLimit: number | null;
  /** Seats the host opened (2..8). */
  maxPlayers: number;
  /**
   * Which rules the host chose. Absent on a lobby created before Coups bas
   * existed, which is exactly the original deck.
   */
  ruleset?: RulesetId;
  /** Coups bas sub-option "Nuit noire". */
  brutal?: boolean;
  createdAt: number | object;
}

/** Written once when the race actually begins: pins how many seats take part. */
export interface StartInfo {
  count: number;
  at: number | object;
}

export interface SeatInfo {
  uid: string;
  name: string;
}

export interface PublicState {
  /** Current course key, e.g. "c1". */
  course: string;
  /** Key the next action must use, e.g. "a0012". */
  next: string;
  /**
   * Seat allowed to write the next action, as a string so the rules can splice
   * it into a path. This is the engine's `actor`, which a Rafale hands to its
   * target — it is not always the seat whose turn it is.
   */
  actor: string;
  /**
   * Derived from the engine's own phases rather than listed again here. A
   * hand-written list drifts silently: it claimed four phases while the client
   * cast and wrote five, and the database rules — which key off this value —
   * had no way to know. "settling" is the one phase the engine does not have:
   * it marks the moment a race is scored and the writer keeps the pen.
   */
  phase: Exclude<GamePhase, "roundOver" | "gameOver"> | "settling";
  /** Ref of the next undrawn card, e.g. "d/17". */
  cursorRef: string;
  /**
   * Key of the course that would follow. The rules only accept a deal at
   * exactly this key, which pins new courses to the proper sequence.
   */
  nextCourse: string;
}

export interface PresenceInfo {
  online: boolean;
  lastSeen: number | object;
}

export type ResultReason = "score" | "abandon" | "claim";

export interface GameResult {
  winner: Seat | -1; // -1 = draw
  reason: ResultReason;
  /** Seat that recorded the result, as a string (the rules splice it in). */
  by: string;
}

export interface CourseData {
  deal?: { at?: number | object };
  actions?: Record<string, WireAction>;
  /** Per-seat peek markers: each actor unlocks exactly one card at a time. */
  peek?: Record<string, string>;
}

/** Absence (ms) before the UI offers to claim or exclude. Rules enforce 60s. */
export const CLAIM_AFTER_MS = 75_000;

/** A lobby nobody joined for this long is treated as expired client-side. */
export const GAME_EXPIRY_MS = 24 * 60 * 60 * 1000;
