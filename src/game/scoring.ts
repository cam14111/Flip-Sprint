// Race scoring. Kept apart from the engine so the UI (and the AI) can price a
// lane at any moment without going through a transition.

import {
  bonusValue,
  isBonusCard,
  isNumberCard,
  PERFECT_BONUS,
  RunnerState,
  TURBO,
} from "./types";

// ---------------------------------------------------------------------------
// Lane readers — the lane holds real cards, everything else is derived from it
// so the two can never fall out of sync.
// ---------------------------------------------------------------------------

export const laneNumbers = (runner: RunnerState): number[] =>
  runner.lane.flatMap((c) => (isNumberCard(c.code) ? [c.code] : []));

export const numberCount = (runner: RunnerState): number =>
  runner.lane.reduce((n, c) => (isNumberCard(c.code) ? n + 1 : n), 0);

export const hasNumber = (runner: RunnerState, value: number): boolean =>
  runner.lane.some((c) => c.code === value);

export const hasTurbo = (runner: RunnerState): boolean =>
  runner.lane.some((c) => c.code === TURBO);

export const laneBonuses = (runner: RunnerState): number[] =>
  runner.lane.flatMap((c) => (isBonusCard(c.code) ? [bonusValue(c.code)] : []));

/**
 * What a lane is worth. Turbo doubles the *number cards only*; Bonus cards are
 * added afterwards, and the Sprint parfait bonus on top of that. A cramp wipes
 * everything, modifiers included.
 */
export const laneScore = (runner: RunnerState): number => {
  if (runner.status === "cramped") return 0;
  const numbers = laneNumbers(runner).reduce((sum, v) => sum + v, 0);
  const bonuses = laneBonuses(runner).reduce((sum, v) => sum + v, 0);
  return (
    numbers * (hasTurbo(runner) ? 2 : 1) +
    bonuses +
    (runner.perfect ? PERFECT_BONUS : 0)
  );
};

/** Highest total among runners still in the game. */
export const bestTotal = (players: RunnerState[]): number =>
  players.reduce((best, p) => (p.out ? best : Math.max(best, p.totalScore)), -Infinity);

/** Seats tied at the highest total (one entry unless the leaders are level). */
export const leaders = (players: RunnerState[]): number[] => {
  const best = bestTotal(players);
  return players.flatMap((p, seat) => (!p.out && p.totalScore === best ? [seat] : []));
};

export const activeSeats = (players: RunnerState[]): number[] =>
  players.flatMap((p, seat) => (p.out ? [] : [seat]));

export const activeCount = (players: RunnerState[]): number =>
  players.reduce((n, p) => (p.out ? n : n + 1), 0);

/** Runners still able to take a card this race. */
export const runningSeats = (players: RunnerState[]): number[] =>
  players.flatMap((p, seat) =>
    !p.out && p.status === "running" ? [seat] : []
  );
