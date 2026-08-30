// Deterministic replay: (course number + action log) → GameState.
//
// Every device feeds the exact same inputs through the exact same pure engine,
// so the projected state is identical everywhere by construction. Card codes
// start as placeholders — the deck order is the game's one secret — and the
// real code is injected the moment a `hit` action makes it public.
//
// Forfeits travel *inside* the log, so the exact point at which somebody leaves
// is totally ordered with the moves around it and every device applies it at
// the same position.

import {
  forfeitRunner,
  legalCardPicks,
  legalTargets,
  reduce,
} from "@/game/engine";
import { DECK_SIZE } from "@/game/deck";
import {
  Card,
  CardCode,
  Difficulty,
  RulesetId,
  GameState,
  RunnerState,
} from "@/game/types";
import { deckRef, OnlineAction, Seat } from "./protocol";

export interface CourseInput {
  course: number;
  /** Actions in play order (sorted by key). */
  actions: OnlineAction[];
}

export interface ReplayConfig {
  /** Display names, by seat. */
  names: string[];
  scoreLimit: number;
  roundLimit: number | null;
  /**
   * Which rules the lobby was created under. Absent on a game started before
   * Coups bas existed, which is exactly the original deck.
   */
  ruleset?: RulesetId;
  brutal?: boolean;
  /** Seats actually playing this game (start.count). */
  playerCount: number;
}

export interface ReplayResult {
  state: GameState;
  /** An action in the log was illegal for the engine — a peer misbehaving. */
  corrupted: boolean;
  /** Number of actions in the current course (== the next action number). */
  actionCount: number;
  /** Ref of the next undrawn card ("d/17"). */
  cursorRef: string;
  /** Cards taken so far this course. */
  draws: number;
}

/** A card whose code nobody has seen yet. */
const placeholder = (index: number): Card => ({ id: deckRef(index), code: 0 });

const freshRunner = (seat: Seat, name: string): RunnerState => ({
  id: `seat${seat}`,
  name,
  isAI: false,
  lane: [],
  secondWind: null,
  status: "running",
  perfect: false,
  opened: false,
  totalScore: 0,
  lastRoundScore: 0,
  roundScores: [],
  lastLane: [],
});

/** Fresh engine state for one course, carrying standings from the previous. */
export const initialCourseState = (
  previous: GameState | null,
  config: ReplayConfig,
  course: number
): GameState => {
  const players: RunnerState[] = Array.from(
    { length: config.playerCount },
    (_, seat) => {
      const base = freshRunner(seat, config.names[seat] ?? `Coureur ${seat + 1}`);
      const carried = previous?.players[seat];
      return carried
        ? {
            ...base,
            totalScore: carried.totalScore,
            lastRoundScore: carried.lastRoundScore,
            roundScores: carried.roundScores,
            lastLane: carried.lastLane,
            out: carried.out,
            status: carried.out ? "banked" : "running",
          }
        : base;
    }
  );

  const ruleset: RulesetId = config.ruleset ?? "classique";

  // The opening deal moves one seat left each course, exactly as the local
  // engine does — the two must agree or replay would diverge from a solo game.
  const seats = players.flatMap((p, seat) => (p.out ? [] : [seat]));
  const first = seats[(course - 1) % Math.max(1, seats.length)] ?? 0;

  return {
    mode: "online",
    players,
    turnSeat: first,
    actor: first,
    phase: "draw",
    burstLeft: 0,
    deferred: [],
    burstQueue: [],
    pendingAssign: null,
    mustBank: null,
    bounty: null,
    bountyVictim: null,
    deck: Array.from({ length: DECK_SIZE[ruleset] }, (_, i) => placeholder(i)),
    discard: [],
    round: course,
    scoreLimit: config.scoreLimit,
    roundLimit: config.roundLimit,
    // Unused online (no AI runners), but part of the state shape.
    difficulty: "normal" as Difficulty,
    ruleset,
    brutal: ruleset === "coupsbas" && (config.brutal ?? false),
    events: [],
    // Fixed seed: the engine's reshuffle, should the deck ever run dry, has to
    // produce the same order on every device.
    rngState: (0x5f5e0ff ^ course) >>> 0,
  };
};

/** Reveals the card an action discloses, at the top of the deck. */
const revealTop = (state: GameState, code: CardCode): GameState => {
  const top = state.deck[0];
  if (!top) return state;
  const deck = state.deck.slice();
  deck[0] = { ...top, code };
  return { ...state, deck };
};

/** Runs one protocol action through the engine. Returns null if it was illegal. */
const applyAction = (state: GameState, action: OnlineAction): GameState | null => {
  if (action.type === "forfeit") {
    const target = state.players[action.seat];
    if (!target || target.out) return null;
    const next = forfeitRunner(state, action.seat);
    return next === state ? null : next;
  }

  // The engine always acts for `state.actor`; enforce it explicitly so a forged
  // log cannot make one seat play for another.
  if (state.actor !== action.seat) return null;

  let working = state;
  if (action.type === "hit") {
    if (action.value === undefined) return null;
    // The ref must name the card actually on top, or the log is inconsistent.
    if (action.ref !== undefined && action.ref !== state.deck[0]?.id) return null;
    working = revealTop(working, action.value);
  }

  if (action.type === "assign") {
    if (action.target === undefined) return null;
    if (!legalTargets(working).includes(action.target)) return null;
    const next = reduce(working, { type: "assign", target: action.target });
    return next === working ? null : next;
  }

  if (action.type === "pick") {
    // The card is already face up in a lane, so the log names it and every
    // device resolves the same move. Legality is checked here rather than in
    // the database, which never sees a lane at all.
    if (action.ref === undefined) return null;
    if (!legalCardPicks(working).includes(action.ref)) return null;
    const next = reduce(working, { type: "pick", ref: action.ref });
    return next === working ? null : next;
  }

  const next = reduce(working, { type: action.type === "hit" ? "hit" : "stay" });
  return next === working ? null : next;
};

export const replayCourse = (
  previous: GameState | null,
  config: ReplayConfig,
  input: CourseInput
): ReplayResult => {
  let state = initialCourseState(previous, config, input.course);
  let corrupted = false;
  let draws = 0;

  for (const action of input.actions) {
    const next = applyAction(state, action);
    if (!next) {
      corrupted = true;
      break;
    }
    if (action.type === "hit") draws += 1;
    state = next;
  }

  return {
    state,
    corrupted,
    actionCount: input.actions.length,
    cursorRef: deckRef(draws),
    draws,
  };
};

/** Replays a whole game (every course, in order). */
export const replayGame = (
  config: ReplayConfig,
  courses: CourseInput[]
): ReplayResult => {
  let previous: GameState | null = null;
  let last: ReplayResult | null = null;

  for (const course of courses) {
    last = replayCourse(previous, config, course);
    if (last.corrupted) return last;
    previous = last.state;
  }

  return (
    last ?? {
      state: initialCourseState(null, config, 1),
      corrupted: false,
      actionCount: 0,
      cursorRef: deckRef(0),
      draws: 0,
    }
  );
};
