// Small immutable helpers shared by the engine and by every ruleset.
//
// They live apart from `engine.ts` for one reason: a ruleset needs them to
// resolve a card, and the engine needs the ruleset to know what a card does.
// Putting them here breaks that cycle without making either side aware of the
// other.

import { shuffle } from "./deck";
import { Card, GameEvent, GameState, RunnerState } from "./types";

export const withEvent = (state: GameState, event: GameEvent): GameState => ({
  ...state,
  events: [...state.events, event],
});

export const patchRunner = (
  state: GameState,
  seat: number,
  patch: (runner: RunnerState) => RunnerState
): GameState => {
  const players = state.players.slice();
  players[seat] = patch(players[seat]);
  return { ...state, players };
};

export const toDiscard = (state: GameState, cards: Card[]): GameState =>
  cards.length === 0
    ? state
    : { ...state, discard: [...state.discard, ...cards] };

/**
 * Takes the top card, reshuffling the discard back in if the deck ran dry.
 * A race can consume at most the whole deck, so this is close to theoretical —
 * but it has to be deterministic, hence the in-state RNG rather than a fresh
 * random source.
 */
export const takeCard = (
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
