// Helpers shared by the engine, odds and replay test suites.
//
// The engine is pure, so the only thing a test needs in order to pin down a
// scenario exactly is control over the deck. `stackedGame` gives that: the
// codes are handed out top-first, in the order written.

import { DECK_SIZE } from "./deck";
import {
  canStay,
  createGame,
  CreateGameOptions,
  legalCardPicks,
} from "./engine";
import { drawableCounts } from "./odds";
import {
  Card,
  CardCode,
  GameAction,
  GameState,
  isNumberCard,
  isPenaltyCard,
} from "./types";

/** A game whose deck is exactly `codes`, first element drawn first. */
export const stackedGame = (
  codes: CardCode[],
  opts: CreateGameOptions = {}
): GameState => {
  const base = createGame({ names: ["A", "B"], ...opts });
  const deck: Card[] = codes.map((code, i) => ({ id: `d/${i}`, code }));
  return { ...base, deck, discard: [] };
};

/** Every card currently accounted for, wherever it sits. */
export const allCards = (state: GameState): Card[] => [
  ...state.deck,
  ...state.discard,
  ...state.deferred,
  ...(state.pendingAssign ? [state.pendingAssign.card] : []),
  ...state.players.flatMap((p) => [
    ...p.lane,
    ...(p.secondWind ? [p.secondWind] : []),
  ]),
];

/**
 * Invariants that must hold after *every* transition. Checked by the targeted
 * tests and hammered by the fuzz suite.
 *
 * `deckSize` is how many cards this particular game was dealt. Targeted tests
 * stack a handful of chosen cards, so the public-odds check — which reasons
 * from the standard 94-card composition — only applies to real games.
 */
export const checkInvariants = (state: GameState, deckSize: number): void => {
  const cards = allCards(state);
  if (cards.length !== deckSize) {
    throw new Error(`card conservation: ${cards.length} != ${deckSize}`);
  }
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) throw new Error("duplicate card id in play");

  if (deckSize === DECK_SIZE.classique) {
    // The drawable composition must describe exactly the deck that is left.
    let drawable = 0;
    for (const n of drawableCounts(state).values()) {
      if (n < 0) throw new Error("drawable count went negative");
      drawable += n;
    }
    if (drawable !== state.deck.length) {
      throw new Error(`drawable ${drawable} != deck ${state.deck.length}`);
    }
  }

  for (const runner of state.players) {
    const numbers = runner.lane.flatMap((c) =>
      isNumberCard(c.code) ? [c.code] : []
    );
    if (new Set(numbers).size !== numbers.length) {
      throw new Error(`${runner.name} holds a duplicate number`);
    }
    if (numbers.length > 7) {
      throw new Error(`${runner.name} holds ${numbers.length} numbers`);
    }
    // A cramped lane is emptied — except in Nuit noire, where a penalty may
    // still be dropped onto it.
    if (runner.status === "cramped" && runner.lane.some((c) => !isPenaltyCard(c.code))) {
      throw new Error(`${runner.name} is cramped but holds more than penalties`);
    }
  }

  // A card in flight and the phase that resolves it go together, both ways.
  const resolving = state.phase === "targeting" || state.phase === "picking";
  if (resolving && !state.pendingAssign) {
    throw new Error(`${state.phase} phase with nothing to resolve`);
  }
  if (state.pendingAssign && !resolving) {
    throw new Error("a card awaits resolution outside a resolving phase");
  }
};

/** A tiny deterministic RNG so fuzz runs are reproducible from their seed. */
export const makeRng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
};

/** Picks a legal action at random for whatever the state is waiting on. */
export const randomAction = (
  state: GameState,
  targets: number[],
  rand: () => number
): GameAction => {
  // "bounty" answers to the same gesture as "targeting": point at a runner.
  if (state.phase === "targeting" || state.phase === "bounty") {
    return { type: "assign", target: targets[Math.floor(rand() * targets.length)] };
  }
  if (state.phase === "picking") {
    const picks = legalCardPicks(state);
    return { type: "pick", ref: picks[Math.floor(rand() * picks.length)] };
  }
  if (state.phase === "draw") return { type: "hit" };
  // Coups bas: the Faux départ takes the choice away from whoever holds it.
  if (!canStay(state)) return { type: "hit" };
  return rand() < 0.6 ? { type: "hit" } : { type: "stay" };
};
