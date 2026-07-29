// Cramp odds, computed from PUBLIC information only.
//
// This is deliberate. Every card in Flip Sprint is turned face up the moment it
// is drawn, so the composition of what is left is common knowledge — the risk
// gauge shown to the player and the AI's own reasoning are therefore the exact
// same computation, and neither can ever peek at `state.deck`. That also means
// the number is identical on every device in an online race.

import { deckComposition } from "./deck";
import { hasNumber } from "./scoring";
import { CardCode, GameState, isNumberCard } from "./types";

/**
 * How many of each card could still come out of the deck.
 *
 * Derived by subtracting everything visible from the full 94-card composition,
 * which keeps the identity `sum(drawableCounts) === deck.length` true even
 * across a mid-race reshuffle (the discard folds back into the deck, and both
 * sides of the subtraction move together).
 */
export const drawableCounts = (state: GameState): Map<CardCode, number> => {
  const counts = deckComposition();
  const seen = (code: CardCode) => counts.set(code, (counts.get(code) ?? 0) - 1);

  for (const runner of state.players) {
    for (const card of runner.lane) seen(card.code);
    if (runner.secondWind) seen(runner.secondWind.code);
  }
  for (const card of state.discard) seen(card.code);
  for (const card of state.deferred) seen(card.code);
  if (state.pendingAssign) seen(state.pendingAssign.card.code);

  return counts;
};

export interface DrawOdds {
  /** Probability the next card cramps this runner (0 … 1). */
  cramp: number;
  /** Probability it is a number card that is safe for them. */
  safe: number;
  /** Mean points added by a safe number card (0 when none can help). */
  meanGain: number;
  /** Cards still unseen. */
  remaining: number;
}

/**
 * Odds for the next card `seat` would take. A Second souffle in hand absorbs
 * the first duplicate, so it drives the cramp risk to zero for one card.
 */
export const drawOdds = (state: GameState, seat: number): DrawOdds => {
  const runner = state.players[seat];
  const counts = drawableCounts(state);

  let remaining = 0;
  let duplicates = 0;
  let safeNumbers = 0;
  let safeTotal = 0;

  for (const [code, n] of counts) {
    if (n <= 0) continue;
    remaining += n;
    if (!isNumberCard(code)) continue;
    if (hasNumber(runner, code)) {
      duplicates += n;
    } else {
      safeNumbers += n;
      safeTotal += n * code;
    }
  }

  if (remaining === 0) {
    return { cramp: 0, safe: 0, meanGain: 0, remaining: 0 };
  }
  return {
    cramp: runner.secondWind ? 0 : duplicates / remaining,
    safe: safeNumbers / remaining,
    meanGain: safeNumbers === 0 ? 0 : safeTotal / safeNumbers,
    remaining,
  };
};

/** Shorthand used by the risk gauge. */
export const crampRisk = (state: GameState, seat: number): number =>
  drawOdds(state, seat).cramp;
