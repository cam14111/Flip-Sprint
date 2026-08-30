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

import { dealDeck } from "./deck";
import {
  applyPick,
  assignCoupsBas,
  legalPicks,
  needsCardPick,
  SQUALL_SIZE,
} from "./coupsbas";
import { receive } from "./lane";
import { patchRunner, takeCard, toDiscard, withEvent } from "./state";
import {
  activeCount,
  activeSeats,
  holdsCard,
  laneScore,
  leaders,
  runningSeats,
} from "./scoring";
import {
  BURST,
  BURST_SIZE,
  Card,
  COUP_DE_BARRE,
  FAUX_DEPART,
  Difficulty,
  GameAction,
  GameMode,
  GameState,
  isCoupsBasAction,
  isModifierCard,
  isNumberCard,
  isPenaltyCard,
  penaltyValue,
  RELAY,
  RulesetId,
  PERFECT_BONUS,
  RunnerState,
  SECOND_WIND,
  SQUALL,
  TURBO,
  WHISTLE,
} from "./types";

export const MIN_RUNNERS = 2;
export const MAX_RUNNERS = 8;
export const DEFAULT_SCORE_LIMIT = 200;

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
  /** Which rules to play under. Defaults to the original deck. */
  ruleset?: RulesetId;
  /** Coups bas "Nuit noire": race scores may go below zero. */
  brutal?: boolean;
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
  const ruleset = opts.ruleset ?? "classique";
  const { cards, state: rngState } = dealDeck(seed, ruleset);

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
    mustBank: null,
    bounty: null,
    bountyVictim: null,
    deck: cards,
    discard: [],
    round: 1,
    scoreLimit: opts.scoreLimit ?? DEFAULT_SCORE_LIMIT,
    roundLimit: opts.roundLimit ?? null,
    difficulty: opts.difficulty ?? "normal",
    ruleset,
    // Nuit noire is a Coups bas option; it means nothing under classique rules.
    brutal: ruleset === "coupsbas" && (opts.brutal ?? false),
    events: [],
    rngState,
  };
};

/** Starts the next race, carrying totals over. */
export const dealNextRound = (prev: GameState): GameState => {
  const { cards, state: rngState } = dealDeck(prev.rngState, prev.ruleset);
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
    mustBank: null,
    bounty: null,
    bountyVictim: null,
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

  // Coups bas: catching your breath no longer puts you out of reach. A runner
  // who has banked keeps their cards on the table, so they can still be given
  // a penalty, robbed, or swapped with — and can still cramp afterwards. Only
  // a cramped lane is beyond help, and even that changes under Nuit noire,
  // where a penalty can still be piled onto it.
  if (
    isPenaltyCard(code) ||
    code === COUP_DE_BARRE ||
    isCoupsBasAction(code)
  ) {
    const penalty = isPenaltyCard(code) || code === COUP_DE_BARRE;
    return state.players.flatMap((p, seat) => {
      if (p.out) return [];
      if (p.status === "running" || p.status === "banked") return [seat];
      return penalty && state.brutal && p.status === "cramped" ? [seat] : [];
    });
  }

  return running;
};

/** Which cards the actor may point at (phase "picking"). */
export const legalCardPicks = (state: GameState): string[] =>
  legalPicks(state, (code) => targetsFor(state, code, state.actor));

/**
 * Nuit noire: who a Sprint parfait may be turned against. Anyone still in the
 * game but its author — a strike lands on a total, so even a cramped rival is
 * fair game.
 */
const bountyTargets = (state: GameState, from: number): number[] =>
  state.players.flatMap((p, seat) => (p.out || seat === from ? [] : [seat]));

export const legalTargets = (state: GameState): number[] => {
  if (state.phase === "bounty" && state.bounty !== null) {
    // Keeping the bonus is choosing yourself, so the author is a target too.
    return [state.bounty, ...bountyTargets(state, state.bounty)];
  }
  return state.pendingAssign
    ? targetsFor(state, state.pendingAssign.card.code, state.actor)
    : [];
};

/**
 * True when the actor is allowed to catch their breath rather than accelerate.
 *
 * The Faux départ takes that choice away: whoever holds it has to keep running
 * and can only redeem the race with a Sprint parfait. The restriction lives
 * with the card, so losing it — robbed, swapped, made to drop it — hands the
 * choice straight back.
 */
export const canStay = (state: GameState): boolean => {
  if (state.phase !== "decide") return false;
  const runner = state.players[state.actor];
  return runner.opened && !holdsCard(runner, FAUX_DEPART);
};

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
  // Le Mur, the duplicate rule, the Second souffle and the Sprint parfait all
  // depend on the lane rather than on the turn, so they live in `lane.ts` —
  // shared with the Coups bas cards that move a card from one lane to another.
  if (isNumberCard(card.code)) return receive(s, seat, card);

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

  // --- Penalty ------------------------------------------------------------
  // Handed to a runner rather than kept, exactly like an action card — and set
  // aside in the same way when it turns up in the middle of a Bourrasque.
  if (isPenaltyCard(card.code) || card.code === COUP_DE_BARRE) {
    if (inBurst) return { ...s, deferred: [...s.deferred, card] };
    return { ...s, pendingAssign: { card, deferred: false }, phase: "targeting" };
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

  // --- Action cards --------------------------------------------------------
  // Drawn during a Rafale or a Bourrasque, these are set aside and only handed
  // out once it is over — and discarded outright if the runner cramps or
  // sprints perfectly in the meantime.
  if (inBurst) {
    return { ...s, deferred: [...s.deferred, card] };
  }
  // A Relais names no runner: it points straight at two cards, wherever they
  // sit, so it skips the targeting step entirely.
  if (card.code === RELAY) {
    return { ...s, pendingAssign: { card, deferred: false }, phase: "picking" };
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
  const scores = state.players.map((p, seat) => {
    if (p.out) return 0;
    // A strike is taken off the victim's TOTAL, so it rides in as a negative
    // race score — that keeps every total the plain sum of its races.
    const strike = seat === state.bountyVictim ? PERFECT_BONUS : 0;
    return laneScore(p, state.brutal) - strike;
  });
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
      // A cramped runner already snapshotted their lane when it collapsed.
      lastLane: p.status === "cramped" ? p.lastLane : p.lane.map((c) => c.code),
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
    mustBank: null,
    bounty: null,
    bountyVictim: null,
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
  // A Sprint parfait ends the race for everyone, right now — except under
  // Nuit noire, where its author first chooses what to do with it.
  const sprinter = state.players.findIndex((p) => p.perfect);
  if (sprinter !== -1) {
    if (state.brutal && state.bounty === null && state.bountyVictim === null) {
      const victims = bountyTargets(state, sprinter);
      if (victims.length > 0) {
        return { ...state, bounty: sprinter, actor: sprinter, phase: "bounty" };
      }
    }
    return endRound(state);
  }
  if (runningSeats(state.players).length === 0) return endRound(state);

  // Mid-resolution: a card is waiting to be handed out or pointed at. The two
  // are not interchangeable — a Relais takes two picks in a row, and dropping
  // back to "targeting" between them would strand it.
  const pending = state.pendingAssign;
  if (pending) {
    const picking =
      pending.card.code === RELAY ||
      (needsCardPick(pending.card.code) && pending.target !== undefined);
    const next: GameState = { ...state, phase: picking ? "picking" : "targeting" };
    const options = picking
      ? legalCardPicks(next).length
      : targetsFor(next, pending.card.code, next.actor).length;
    // An action with nowhere to go is simply discarded — a Relais needs two
    // lanes holding cards, and late in a race there may not be two left.
    if (options === 0) {
      return advance(
        toDiscard({ ...state, pendingAssign: null }, [pending.card])
      );
    }
    return next;
  }

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

  // A Dernière ligne droite: the forced card has been resolved, so its target
  // is now made to stop — unless the card already took them out of the race.
  if (s.mustBank !== null) {
    const seat = s.mustBank;
    s = { ...s, mustBank: null };
    if (s.players[seat].status === "running") {
      s = withEvent(
        patchRunner(s, seat, (r) => ({ ...r, status: "banked" })),
        { type: "banked", seat }
      );
      if (runningSeats(s.players).length === 0) return endRound(s);
    }
  }

  if (s.deferred.length > 0) {
    // Back through `advance` rather than straight to "targeting": a Relais set
    // aside during a Bourrasque names no runner, so it has to reach the picking
    // phase like it would have done had it been drawn on its own.
    const [card, ...rest] = s.deferred;
    return advance({
      ...s,
      deferred: rest,
      pendingAssign: { card, deferred: true },
    });
  }

  // Queued Rafales run once every pending assignment has been made. A runner
  // queued earlier may have been whistled since — skip anyone no longer racing.
  while (s.burstQueue.length > 0) {
    const [target, ...rest] = s.burstQueue;
    s = { ...s, burstQueue: rest };
    const runner = s.players[target];
    // Under classique rules a runner who has stopped — banked or whistled — is
    // out of reach. Coups bas is the one that takes that shelter away, and it
    // must not leak back into the original game.
    const reachable =
      s.ruleset === "coupsbas"
        ? runner.status === "running" || runner.status === "banked"
        : runner.status === "running";
    if (!runner.out && reachable) {
      return withEvent(
        {
          ...s,
          actor: target,
          burstLeft: s.ruleset === "coupsbas" ? SQUALL_SIZE : BURST_SIZE,
          phase: "draw",
        },
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
      // A forced card — a Rafale, a Bourrasque, a Dernière ligne droite —
      // reaches a runner who has already caught their breath: in Coups bas,
      // stopping is no longer a shelter. Only a cramped lane is beyond reach.
      const forced = state.burstLeft > 0;
      if (runner.out) return prev;
      if (runner.status !== "running" && !(forced && runner.status === "banked")) {
        return prev;
      }

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
      // Nuit noire: the same gesture — point at a runner — settles what a
      // Sprint parfait is worth. Pointing at yourself keeps the +15.
      if (state.phase === "bounty" && state.bounty !== null) {
        if (!legalTargets(state).includes(action.target)) return prev;
        const author = state.bounty;
        let s: GameState = { ...state, bounty: null };
        if (action.target !== author) {
          s = patchRunner(s, author, (r) => ({ ...r, struck: true }));
          s = withEvent({ ...s, bountyVictim: action.target }, {
            type: "struck",
            seat: action.target,
            by: author,
          });
        }
        return endRound(s);
      }

      const pending = state.pendingAssign;
      if (state.phase !== "targeting" || !pending) return prev;
      if (!legalTargets(state).includes(action.target)) return prev;

      const { card } = pending;
      let s: GameState = { ...state, pendingAssign: null };

      if (isPenaltyCard(card.code) || card.code === COUP_DE_BARRE) {
        s = patchRunner(s, action.target, (r) => ({
          ...r,
          lane: [...r.lane, card],
        }));
        s = withEvent(
          s,
          card.code === COUP_DE_BARRE
            ? { type: "coupDeBarre", seat: action.target, by: state.actor }
            : {
                type: "penalty",
                seat: action.target,
                value: penaltyValue(card.code),
                by: state.actor,
              }
        );
      } else if (card.code === SECOND_WIND) {
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
      } else if (card.code === BURST || card.code === SQUALL) {
        s = toDiscard(s, [card]);
        s = { ...s, burstQueue: [...s.burstQueue, action.target] };
      } else {
        const handled = assignCoupsBas(s, card, action.target, state.actor);
        if (!handled) return prev;
        s = handled;
      }

      return advance(s);
    }

    case "pick": {
      if (state.phase !== "picking" || !state.pendingAssign) return prev;
      if (!legalCardPicks(state).includes(action.ref)) return prev;
      return advance(applyPick(state, action.ref));
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
