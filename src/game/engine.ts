// The Flip Sprint rules engine: a pure reducer over the whole game state.
//
// Two things drive the design.
//
// 1. Purity. No Date.now(), no Math.random(), no I/O. The RNG seed lives in the
//    state, so `reduce` is a total function of its inputs. That is what lets an
//    online race replay the same action log on every device and land on
//    byte-identical states.
//
// 2. `actor` is not `turnSeat`. A Rafale hands the initiative to its target for
//    three cards, and any action card set aside during that Rafale is handed
//    out by the target afterwards. Every legality question — here, in the wire
//    protocol and in the database rules — is asked about `actor`.

import { dealDeck, shuffle } from "./deck";
import {
  activeCount,
  activeSeats,
  hasNumber,
  laneScore,
  leaders,
  numberCount,
  runningSeats,
} from "./scoring";
import {
  BURST,
  BURST_SIZE,
  Card,
  Difficulty,
  GameAction,
  GameEvent,
  GameMode,
  GameState,
  isModifierCard,
  isNumberCard,
  PERFECT_COUNT,
  RunnerState,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "./types";

export const MIN_RUNNERS = 2;
export const MAX_RUNNERS = 8;
export const DEFAULT_SCORE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Small immutable helpers
// ---------------------------------------------------------------------------

const withEvent = (state: GameState, event: GameEvent): GameState => ({
  ...state,
  events: [...state.events, event],
});

const patchRunner = (
  state: GameState,
  seat: number,
  patch: (runner: RunnerState) => RunnerState
): GameState => {
  const players = state.players.slice();
  players[seat] = patch(players[seat]);
  return { ...state, players };
};

const toDiscard = (state: GameState, cards: Card[]): GameState =>
  cards.length === 0 ? state : { ...state, discard: [...state.discard, ...cards] };

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

export interface CreateGameOptions {
  mode?: GameMode;
  names?: string[];
  /** Seats driven by the AI (solo mode). */
  aiSeats?: number[];
  scoreLimit?: number;
  /** "Éclair": stop after this many races instead of at a score. */
  roundLimit?: number | null;
  difficulty?: Difficulty;
  seed?: number;
}

const freshRunner = (
  seat: number,
  name: string,
  isAI: boolean
): RunnerState => ({
  id: `seat${seat}`,
  name,
  isAI,
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

/** Clears a runner's race state, keeping their standing in the game. */
const resetForRace = (runner: RunnerState): RunnerState => ({
  ...runner,
  lane: [],
  secondWind: null,
  status: runner.out ? runner.status : "running",
  perfect: false,
  opened: false,
});

export const createGame = (opts: CreateGameOptions = {}): GameState => {
  const names = opts.names ?? ["Joueur 1", "Joueur 2"];
  const count = Math.max(MIN_RUNNERS, Math.min(MAX_RUNNERS, names.length));
  const aiSeats = new Set(opts.aiSeats ?? []);
  const players = Array.from({ length: count }, (_, seat) =>
    freshRunner(seat, names[seat] ?? `Joueur ${seat + 1}`, aiSeats.has(seat))
  );

  const seed = opts.seed ?? 1;
  const { cards, state: rngState } = dealDeck(seed);

  return {
    mode: opts.mode ?? "local",
    players,
    turnSeat: 0,
    actor: 0,
    phase: "draw", // everyone's first card of the race is dealt to them
    burstLeft: 0,
    deferred: [],
    burstQueue: [],
    pendingAssign: null,
    deck: cards,
    discard: [],
    round: 1,
    scoreLimit: opts.scoreLimit ?? DEFAULT_SCORE_LIMIT,
    roundLimit: opts.roundLimit ?? null,
    difficulty: opts.difficulty ?? "normal",
    events: [],
    rngState,
  };
};

/** Starts the next race, carrying totals over. */
export const dealNextRound = (prev: GameState): GameState => {
  const { cards, state: rngState } = dealDeck(prev.rngState);
  const players = prev.players.map(resetForRace);
  const round = prev.round + 1;

  // The opening deal moves one seat to the left every race.
  const seats = activeSeats(players);
  const first = seats[(round - 1) % Math.max(1, seats.length)] ?? 0;

  return {
    ...prev,
    players,
    turnSeat: first,
    actor: first,
    phase: "draw",
    burstLeft: 0,
    deferred: [],
    burstQueue: [],
    pendingAssign: null,
    deck: cards,
    discard: [],
    round,
    events: [],
    rngState,
  };
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Takes the top card, reshuffling the discard back in if the deck ran dry.
 * A race can consume at most the whole deck, so this is close to theoretical —
 * but it has to be deterministic, hence the in-state RNG rather than a fresh
 * random source.
 */
const takeCard = (
  state: GameState
): { state: GameState; card: Card } | null => {
  let s = state;
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return null;
    const { items, state: rngState } = shuffle(s.discard, s.rngState);
    s = withEvent(
      { ...s, deck: items, discard: [], rngState },
      { type: "reshuffle" }
    );
  }
  return { state: { ...s, deck: s.deck.slice(1) }, card: s.deck[0] };
};

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------

/**
 * Who may receive the action card currently awaiting a target.
 *
 * A Coup de sifflet or a Rafale goes to any runner still in the race, the
 * actor included. A Second souffle is only ever handed over because the actor
 * already holds one, so it must go to *someone else* who holds none — and if
 * nobody qualifies it is simply discarded.
 */
const targetsFor = (
  state: GameState,
  code: number,
  from: number
): number[] => {
  const running = runningSeats(state.players);
  if (code === SECOND_WIND) {
    return running.filter(
      (seat) => seat !== from && state.players[seat].secondWind === null
    );
  }
  return running;
};

export const legalTargets = (state: GameState): number[] =>
  state.pendingAssign
    ? targetsFor(state, state.pendingAssign.card.code, state.actor)
    : [];

/** True when the actor is allowed to catch their breath rather than accelerate. */
export const canStay = (state: GameState): boolean =>
  state.phase === "decide" && state.players[state.actor].opened;

// ---------------------------------------------------------------------------
// Card resolution
// ---------------------------------------------------------------------------

/**
 * Applies a freshly drawn card to `seat`. `inBurst` says whether this draw is
 * part of a Rafale — it decides whether a Coup de sifflet or a Rafale is handed
 * out now or set aside until the Rafale is over.
 */
const resolveCard = (
  state: GameState,
  seat: number,
  card: Card,
  inBurst: boolean
): GameState => {
  let s = withEvent(state, { type: "drew", seat, code: card.code });
  const runner = s.players[seat];

  // --- Number card --------------------------------------------------------
  if (isNumberCard(card.code)) {
    if (hasNumber(runner, card.code)) {
      if (runner.secondWind) {
        // Both the duplicate and the Second souffle leave play; the runner
        // keeps going. Usable mid-Rafale, unlike the other action cards.
        const spent = runner.secondWind;
        s = patchRunner(s, seat, (r) => ({ ...r, secondWind: null }));
        s = toDiscard(s, [card, spent]);
        return withEvent(s, {
          type: "secondWindUsed",
          seat,
          value: card.code,
        });
      }
      // Crampe: the lane is worth nothing and every card in it leaves play.
      s = toDiscard(s, [...runner.lane, card]);
      s = patchRunner(s, seat, (r) => ({ ...r, lane: [], status: "cramped" }));
      return withEvent(s, { type: "cramp", seat, value: card.code });
    }

    s = patchRunner(s, seat, (r) => ({ ...r, lane: [...r.lane, card] }));
    if (numberCount(s.players[seat]) === PERFECT_COUNT) {
      // Sprint parfait: banked with the bonus, and the race ends for everyone.
      s = patchRunner(s, seat, (r) => ({
        ...r,
        perfect: true,
        status: "banked",
      }));
      return withEvent(s, { type: "perfect", seat });
    }
    return s;
  }

  // --- Modifier card ------------------------------------------------------
  if (isModifierCard(card.code)) {
    s = patchRunner(s, seat, (r) => ({ ...r, lane: [...r.lane, card] }));
    return card.code === TURBO
      ? withEvent(s, { type: "turbo", seat })
      : withEvent(s, {
          type: "bonus",
          seat,
          value: (card.code - 20) * 2 + 2,
        });
  }

  // --- Second souffle -----------------------------------------------------
  if (card.code === SECOND_WIND) {
    if (!runner.secondWind) {
      s = patchRunner(s, seat, (r) => ({ ...r, secondWind: card }));
      return withEvent(s, { type: "secondWindGained", seat });
    }
    // Already holding one: it must be handed to another runner who holds none.
    // Resolved immediately, even in the middle of a Rafale — and if nobody
    // qualifies, the card is simply discarded.
    if (targetsFor(s, SECOND_WIND, seat).length === 0) {
      s = toDiscard(s, [card]);
      return withEvent(s, { type: "secondWindDropped", seat });
    }
    return { ...s, pendingAssign: { card, deferred: false }, phase: "targeting" };
  }

  // --- Coup de sifflet / Rafale -------------------------------------------
  // Drawn during a Rafale, these are set aside and only handed out once the
  // Rafale is over — and discarded outright if the runner cramps or sprints
  // perfectly in the meantime.
  if (inBurst) {
    return { ...s, deferred: [...s.deferred, card] };
  }
  return { ...s, pendingAssign: { card, deferred: false }, phase: "targeting" };
};

// ---------------------------------------------------------------------------
// Round & game end
// ---------------------------------------------------------------------------

const isGameOver = (state: GameState, players: RunnerState[]): boolean => {
  if (activeCount(players) <= 1) return true;
  const done =
    state.roundLimit !== null
      ? state.round >= state.roundLimit
      : players.some((p) => !p.out && p.totalScore >= state.scoreLimit);
  // A shared lead is not a win: the runners settle it over one more race.
  return done && leaders(players).length === 1;
};

export const endRound = (state: GameState): GameState => {
  const scores = state.players.map((p) => (p.out ? 0 : laneScore(p)));
  // Everything still in flight leaves play too — a Sprint parfait can end the
  // race while cards are set aside or awaiting a target.
  const spent: Card[] = [
    ...state.deferred,
    ...(state.pendingAssign ? [state.pendingAssign.card] : []),
  ];
  const players = state.players.map((p, seat) => {
    if (p.out) return p;
    spent.push(...p.lane);
    if (p.secondWind) spent.push(p.secondWind);
    return {
      ...p,
      lane: [],
      secondWind: null,
      lastLane: p.lane.map((c) => c.code),
      totalScore: p.totalScore + scores[seat],
      lastRoundScore: scores[seat],
      roundScores: [...p.roundScores, scores[seat]],
    };
  });

  let s: GameState = {
    ...state,
    players,
    discard: [...state.discard, ...spent],
    burstLeft: 0,
    deferred: [],
    burstQueue: [],
    pendingAssign: null,
    phase: "roundOver",
  };
  s = withEvent(s, { type: "roundOver", scores });

  if (isGameOver(s, players)) {
    const winner = leaders(players)[0] ?? 0;
    s = withEvent({ ...s, phase: "gameOver" }, { type: "gameOver", winner });
  }
  return s;
};

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

const passTurn = (state: GameState): GameState => {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (state.turnSeat + i) % n;
    const runner = state.players[seat];
    if (!runner.out && runner.status === "running") {
      return {
        ...state,
        turnSeat: seat,
        actor: seat,
        burstLeft: 0,
        phase: runner.opened ? "decide" : "draw",
      };
    }
  }
  return endRound(state);
};

/**
 * Works out who acts next once a card (or an assignment) has been resolved.
 *
 * Order matters, and it encodes the trickiest corner of the rules: a runner who
 * cramps or sprints perfectly mid-Rafale drops both the rest of the Rafale and
 * every action card they had set aside.
 */
const advance = (state: GameState): GameState => {
  // A Sprint parfait ends the race for everyone, right now.
  if (state.players.some((p) => p.perfect)) return endRound(state);
  if (runningSeats(state.players).length === 0) return endRound(state);

  // Mid-resolution: an action card is waiting for its target.
  if (state.pendingAssign) return { ...state, phase: "targeting" };

  let s = state;
  // Only a cramp (or a Sprint parfait, already handled above) cancels what a
  // Rafale had in flight. A runner who banked — even by whistling themselves —
  // still hands out the action cards they had set aside.
  const actorStopped = s.players[s.actor].status === "cramped";

  if (actorStopped && (s.burstLeft > 0 || s.deferred.length > 0)) {
    // Cramped during a Rafale: the remaining cards are not dealt, and the
    // action cards set aside are discarded rather than handed out.
    if (s.deferred.length > 0) {
      s = toDiscard(s, s.deferred);
      s = withEvent(s, {
        type: "deferredDropped",
        seat: s.actor,
        count: s.deferred.length,
      });
    }
    s = { ...s, burstLeft: 0, deferred: [] };
  }

  if (s.burstLeft > 0) return { ...s, phase: "draw" };

  if (s.deferred.length > 0) {
    const [card, ...rest] = s.deferred;
    return {
      ...s,
      deferred: rest,
      pendingAssign: { card, deferred: true },
      phase: "targeting",
    };
  }

  // Queued Rafales run once every pending assignment has been made. A runner
  // queued earlier may have been whistled since — skip anyone no longer racing.
  while (s.burstQueue.length > 0) {
    const [target, ...rest] = s.burstQueue;
    s = { ...s, burstQueue: rest };
    const runner = s.players[target];
    if (!runner.out && runner.status === "running") {
      return withEvent(
        { ...s, actor: target, burstLeft: BURST_SIZE, phase: "draw" },
        { type: "burstStart", seat: target, by: s.turnSeat }
      );
    }
  }

  return passTurn(s);
};

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export const reduce = (prev: GameState, action: GameAction): GameState => {
  if (prev.phase === "roundOver" || prev.phase === "gameOver") return prev;
  const state: GameState = { ...prev, events: [] };

  switch (action.type) {
    case "hit": {
      if (state.phase !== "draw" && state.phase !== "decide") return prev;
      const runner = state.players[state.actor];
      if (runner.out || runner.status !== "running") return prev;

      // Deck and discard both empty is unreachable with a 94-card deck, but a
      // frozen table would be the worst possible failure — score the race.
      const drawn = takeCard(state);
      if (!drawn) return endRound(state);

      let s = drawn.state;
      const inBurst = s.burstLeft > 0;
      // Taking a card on your own turn is what "opens" your race: it stands in
      // for the dealer's opening card, so a Rafale never counts for it.
      if (!inBurst && !runner.opened) {
        s = patchRunner(s, state.actor, (r) => ({ ...r, opened: true }));
      }
      if (inBurst) s = { ...s, burstLeft: s.burstLeft - 1 };

      return advance(resolveCard(s, state.actor, drawn.card, inBurst));
    }

    case "stay": {
      if (!canStay(state)) return prev;
      const s = withEvent(
        patchRunner(state, state.actor, (r) => ({ ...r, status: "banked" })),
        { type: "banked", seat: state.actor }
      );
      return advance(s);
    }

    case "assign": {
      const pending = state.pendingAssign;
      if (state.phase !== "targeting" || !pending) return prev;
      if (!legalTargets(state).includes(action.target)) return prev;

      const { card } = pending;
      let s: GameState = { ...state, pendingAssign: null };

      if (card.code === SECOND_WIND) {
        s = patchRunner(s, action.target, (r) => ({ ...r, secondWind: card }));
        s = withEvent(s, {
          type: "secondWindPassed",
          from: state.actor,
          to: action.target,
        });
      } else if (card.code === WHISTLE) {
        s = toDiscard(s, [card]);
        s = patchRunner(s, action.target, (r) => ({ ...r, status: "whistled" }));
        s = withEvent(s, {
          type: "whistled",
          seat: action.target,
          by: state.actor,
        });
      } else if (card.code === BURST) {
        s = toDiscard(s, [card]);
        s = { ...s, burstQueue: [...s.burstQueue, action.target] };
      }

      return advance(s);
    }

    default:
      return prev;
  }
};

// ---------------------------------------------------------------------------
// Leaving the game (online forfeit / exclusion)
// ---------------------------------------------------------------------------

/**
 * Removes a runner from the whole game. Their total freezes where it stands and
 * the rotation skips them. Forfeits travel inside the online action log, so
 * every device applies them at exactly the same point in the sequence.
 */
export const forfeitRunner = (prev: GameState, seat: number): GameState => {
  const runner = prev.players[seat];
  if (!runner || runner.out) return prev;
  if (prev.phase === "gameOver") return prev;

  let s = withEvent(
    patchRunner({ ...prev, events: [] }, seat, (r) => ({
      ...r,
      out: true,
      status: "banked",
    })),
    { type: "forfeit", seat }
  );

  // Their cards leave play, and any Rafale aimed at them is dropped.
  s = toDiscard(s, [
    ...runner.lane,
    ...(runner.secondWind ? [runner.secondWind] : []),
  ]);
  s = patchRunner(s, seat, (r) => ({ ...r, lane: [], secondWind: null }));
  s = { ...s, burstQueue: s.burstQueue.filter((t) => t !== seat) };

  if (activeCount(s.players) <= 1) {
    const winner = activeSeats(s.players)[0] ?? 0;
    return withEvent({ ...s, phase: "gameOver" }, { type: "gameOver", winner });
  }

  if (s.phase === "roundOver") return s;

  // If they were the one holding everyone up, hand the initiative on.
  if (s.actor === seat) {
    if (s.deferred.length > 0) s = toDiscard(s, s.deferred);
    if (s.pendingAssign) s = toDiscard(s, [s.pendingAssign.card]);
    s = { ...s, burstLeft: 0, deferred: [], pendingAssign: null };
    return advance(s);
  }
  return s;
};
