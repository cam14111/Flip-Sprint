// The AI runners.
//
// Every card in Flip Sprint is face up, so a perfect player can count the deck
// exactly. That sounds like it should decide the difficulty ladder. It does not.
//
// A measured finding shaped this file. Card counting is worth far less here
// than it looks: with 94 cards and only a handful face up, "the deck minus my
// own lane" is already a good approximation of the truth, so an exact counter
// beat a naive one barely more than half the time. Deepening the search does
// not help either — an optimal-stopping search makes a runner hit *more*, not
// less, since it correctly sees that a good card can always be followed by
// stopping. Both were tried and measured before being dropped.
//
// So the levels are separated by what they *do*, not by how precisely they
// compute: whether they read the table when handing out an action card,
// whether they play the score at the end of a game, and how much caution they
// carry. Each level is a policy, and the policies are data — which is what lets
// the benchmark in ai.test.ts be honest about their real win rates.

import { deckComposition } from "./deck";
import { canStay, legalCardPicks } from "./engine";
import { cramps } from "./lane";
import {
  hasNumber,
  hasTurbo,
  laneNumbers,
  laneScore,
  numberCount,
  runningSeats,
} from "./scoring";
import {
  bonusValue,
  BURST,
  Card,
  CardCode,
  COUP_DE_BARRE,
  Difficulty,
  DOSSARD_FETICHE,
  DRAFT,
  FAUX_DEPART,
  GameAction,
  GameState,
  isBonusCard,
  isNumberCard,
  isPenaltyCard,
  LE_MUR,
  numberValue,
  penaltyValue,
  PERFECT_BONUS,
  PERFECT_COUNT,
  SECOND_WIND,
  STUMBLE,
  TURBO,
} from "./types";
import { drawableCounts } from "./odds";

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface Policy {
  /** "exact" counts every card on the table; "naive" only its own lane. */
  counts: "exact" | "naive";
  /** "rule" is a plain card-count threshold; "ev" weighs the next card. */
  model: "rule" | "ev";
  /** Multiplier applied to the value of stopping — caution, at or above 1. */
  margin: number;
  /** "smart" reads the table before handing out an action card. */
  targeting: "plain" | "smart";
  /** Plays the finish line: banks a win, chases on a closing race. */
  endgame: boolean;
}

export const POLICIES: Record<Difficulty, Policy> = {
  easy: {
    counts: "naive",
    model: "rule",
    margin: 1,
    targeting: "plain",
    endgame: false,
  },
  normal: {
    counts: "naive",
    model: "ev",
    margin: 1.06,
    targeting: "plain",
    endgame: false,
  },
  hard: {
    counts: "exact",
    model: "ev",
    margin: 1.02,
    targeting: "smart",
    endgame: true,
  },
};

// ---------------------------------------------------------------------------
// What the AI can see
// ---------------------------------------------------------------------------

/**
 * A runner who does not watch the table: they know their own cards and the
 * deck they started from, and nothing else. Deliberately worse than the truth.
 */
const naiveCounts = (state: GameState, seat: number): Map<CardCode, number> => {
  const counts = deckComposition();
  const me = state.players[seat];
  for (const card of me.lane) {
    counts.set(card.code, (counts.get(card.code) ?? 0) - 1);
  }
  if (me.secondWind) {
    counts.set(SECOND_WIND, (counts.get(SECOND_WIND) ?? 0) - 1);
  }
  return counts;
};

const visibleCounts = (
  state: GameState,
  seat: number,
  policy: Policy
): Map<CardCode, number> =>
  policy.counts === "exact" ? drawableCounts(state) : naiveCounts(state, seat);

// ---------------------------------------------------------------------------
// Expected value of taking one more card
// ---------------------------------------------------------------------------

export interface HitEval {
  /** Expected lane value after one more card (a cramp scores zero). */
  ev: number;
  /** Value of the lane if the runner stops here. */
  current: number;
  crampChance: number;
}

export const evaluateHit = (
  state: GameState,
  seat: number,
  counts: Map<CardCode, number>
): HitEval => {
  const me = state.players[seat];
  const current = laneScore(me);
  const numberSum = laneNumbers(me).reduce((sum, v) => sum + v, 0);
  const multiplier = hasTurbo(me) ? 2 : 1;
  const oneShortOfPerfect = numberCount(me) + 1 === PERFECT_COUNT;

  let remaining = 0;
  for (const n of counts.values()) if (n > 0) remaining += n;
  if (remaining === 0) return { ev: current, current, crampChance: 0 };

  let ev = 0;
  let crampChance = 0;

  for (const [code, n] of counts) {
    if (n <= 0) continue;
    const p = n / remaining;

    if (isNumberCard(code)) {
      if (hasNumber(me, code)) {
        // A Second souffle absorbs the duplicate: no gain, but no disaster.
        if (me.secondWind) ev += p * current;
        else crampChance += p; // a cramped lane scores zero, so it adds nothing
      } else {
        ev +=
          p *
          (current +
            code * multiplier +
            (oneShortOfPerfect ? PERFECT_BONUS : 0));
      }
    } else if (isBonusCard(code)) {
      ev += p * (current + bonusValue(code));
    } else if (code === TURBO) {
      // Turbo is only worth anything the first time.
      ev += p * (current + (multiplier === 1 ? numberSum : 0));
    } else {
      // Action cards leave the lane's own value untouched.
      ev += p * current;
    }
  }

  return { ev, current, crampChance };
};

// ---------------------------------------------------------------------------
// Hit or stay
// ---------------------------------------------------------------------------

/** Would stopping right now end the game in this runner's favour? */
const banksTheWin = (
  state: GameState,
  seat: number,
  current: number
): boolean => {
  const me = state.players[seat];
  const total = me.totalScore + current;
  const reachesTheEnd =
    state.roundLimit !== null
      ? state.round >= state.roundLimit
      : total >= state.scoreLimit;
  if (!reachesTheEnd) return false;
  // Only if nobody still on the table can catch that total as things stand.
  return state.players.every(
    (p, i) => i === seat || p.out || p.totalScore + laneScore(p) < total
  );
};

/** How far behind the leader this runner is, ignoring their own lane. */
const deficit = (state: GameState, seat: number): number => {
  const me = state.players[seat];
  const best = state.players.reduce(
    (top, p, i) => (p.out || i === seat ? top : Math.max(top, p.totalScore)),
    0
  );
  return best - me.totalScore;
};

const shouldHit = (state: GameState, seat: number, policy: Policy): boolean => {
  const me = state.players[seat];

  if (policy.model === "rule") {
    // Débutant: counts their own cards and nothing else.
    return numberCount(me) < (me.secondWind ? 6 : 4);
  }

  const counts = visibleCounts(state, seat, policy);
  const { ev, current, crampChance } = evaluateHit(state, seat, counts);

  if (policy.endgame) {
    if (banksTheWin(state, seat, current)) return false;
    // Chasing on a closing race: a safe pile of points that still loses is
    // worth nothing, so accept a worse expected value to have a chance.
    const lastRace =
      state.roundLimit !== null && state.round >= state.roundLimit;
    if (lastRace && deficit(state, seat) > current && crampChance < 0.55) {
      return true;
    }
    // One short of a Sprint parfait is worth a real gamble: it ends the race
    // for everyone and takes the bonus with it.
    if (numberCount(me) + 1 === PERFECT_COUNT && crampChance < 0.5) return true;
  }

  // Adjusting this margin by the standings (bank small when ahead, push when
  // behind) reads as the obvious refinement. It was tried, and it measured
  // worse — 53.5% against Débutant instead of 56.3%. Left out.
  return ev > current * policy.margin;
};

// ---------------------------------------------------------------------------
// Handing out an action card
// ---------------------------------------------------------------------------

/** How much a runner stands to lose if their race ends badly right now. */
const exposure = (state: GameState, seat: number): number =>
  laneScore(state.players[seat]) + state.players[seat].totalScore / 10;

const richestRival = (state: GameState, rivals: number[]): number =>
  rivals.reduce((top, s) => (exposure(state, s) > exposure(state, top) ? s : top));

const pickTarget = (
  state: GameState,
  seat: number,
  legal: number[],
  policy: Policy
): number => {
  const code = state.pendingAssign?.card.code;
  const rivals = legal.filter((s) => s !== seat);

  // --- Second souffle: it must go to someone, so pick the least useful home.
  if (code === SECOND_WIND) {
    if (rivals.length === 0) return legal[0];
    if (policy.targeting === "plain") return rivals[0];
    return rivals.reduce((worst, s) =>
      exposure(state, s) < exposure(state, worst) ? s : worst
    );
  }

  // --- Rafale: three forced cards.
  if (code === BURST) {
    if (rivals.length === 0) return seat;
    if (policy.targeting === "plain") return richestRival(state, rivals);

    const counts = visibleCounts(state, seat, policy);
    const scored = rivals.map((s) => ({
      seat: s,
      harm: evaluateHit(state, s, counts).crampChance * exposure(state, s),
    }));
    const best = scored.reduce((top, c) => (c.harm > top.harm ? c : top));
    // Nobody worth hurting? Free cards are better taken than wasted — but only
    // while my own odds are still kind.
    if (best.harm < 1 && legal.includes(seat)) {
      if (evaluateHit(state, seat, counts).crampChance < 0.2) return seat;
    }
    return best.seat;
  }

  // --- Coup de sifflet: stop whoever is having the best race.
  if (rivals.length === 0) return seat;
  const leader = richestRival(state, rivals);
  if (policy.targeting === "smart" && legal.includes(seat)) {
    // Silencing a rival who has little is a waste; bank my own race instead
    // when it is both bigger and in real danger.
    const counts = visibleCounts(state, seat, policy);
    const mine = evaluateHit(state, seat, counts);
    const worthMore =
      laneScore(state.players[seat]) > laneScore(state.players[leader]);
    if (worthMore && mine.crampChance > 0.3) return seat;
  }
  return leader;
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** The move this AI runner makes, given whatever the board is asking of it. */
export const decideAction = (
  state: GameState,
  legalTargets: number[]
): GameAction | null => {
  const seat = state.actor;
  const me = state.players[seat];
  if (!me?.isAI) return null;
  const policy = POLICIES[state.difficulty];

  switch (state.phase) {
    case "draw":
      return { type: "hit" };
    case "decide":
      // The Faux départ takes the choice away from whoever holds it.
      if (!canStay(state)) return { type: "hit" };
      return shouldHit(state, seat, policy) ? { type: "hit" } : { type: "stay" };
    case "targeting":
      if (legalTargets.length === 0) return null;
      return {
        type: "assign",
        target: pickTarget(state, seat, legalTargets, policy),
      };
    case "picking": {
      const ref = pickCard(state, seat);
      return ref === null ? null : { type: "pick", ref };
    }
    default:
      return null;
  }
};

/** Thinking time, so a move is watchable rather than instant. */
export const thinkingDelay = (state: GameState): number => {
  if (state.phase === "draw") {
    return runningSeats(state.players).length > 4 ? 380 : 520;
  }
  return state.phase === "targeting" ? 780 : 620;
};

// ---------------------------------------------------------------------------
// Coups bas: which card to point at
// ---------------------------------------------------------------------------

/** What a single card is worth to the runner holding it, roughly. */
const cardWorth = (state: GameState, seat: number, card: Card): number => {
  const value = numberValue(card.code);
  if (value !== null) {
    // A number is worth its face — but the Faux départ is a millstone and Le
    // Mur is a bomb, so their holder is better off without them.
    if (card.code === FAUX_DEPART) return -25;
    if (card.code === LE_MUR) return -15;
    if (card.code === DOSSARD_FETICHE) return value + 6;
    return value;
  }
  if (card.code === COUP_DE_BARRE) return -laneScore(state.players[seat]) / 2;
  if (isPenaltyCard(card.code)) return -penaltyValue(card.code);
  return 0;
};

/**
 * Points at a card, for an Aspiration, a Faux pas or a Relais.
 *
 * The same yardstick serves all three: what a card is worth to whoever holds
 * it. Stealing takes the most valuable thing a rival owns — unless it would
 * cramp us, which is exactly the trap these cards set. Making somebody drop a
 * card takes their best. A Relais gives away our worst for their best.
 */
const pickCard = (state: GameState, seat: number): string | null => {
  const pending = state.pendingAssign;
  if (!pending) return null;
  const picks = legalCardPicks(state);
  if (picks.length === 0) return null;

  const find = (ref: string): { seat: number; card: Card } | null => {
    for (let s = 0; s < state.players.length; s++) {
      const card = state.players[s].lane.find((c) => c.id === ref);
      if (card) return { seat: s, card };
    }
    return null;
  };

  const score = (ref: string): number => {
    const found = find(ref);
    if (!found) return -Infinity;
    const worth = cardWorth(state, found.seat, found.card);

    if (pending.card.code === DRAFT) {
      // Taking a number we already hold would cramp us: that is a loss, not a
      // gain, however juicy the card looks.
      if (cramps(state.players[seat], found.card)) return -100;
      return worth;
    }
    if (pending.card.code === STUMBLE) return worth;

    // Relais: first the card we least want, then the best one on offer.
    if (pending.firstRef === undefined) {
      return found.seat === seat ? -worth + 30 : -worth;
    }
    const first = find(pending.firstRef);
    const mine = first?.seat === seat;
    return mine ? worth : -worth;
  };

  return picks.reduce((best, ref) => (score(ref) > score(best) ? ref : best));
};
