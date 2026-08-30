// Race scoring. Kept apart from the engine so the UI (and the AI) can price a
// lane at any moment without going through a transition.

import {
  bonusValue,
  COUP_DE_BARRE,
  FAUX_DEPART,
  isBonusCard,
  isNumberCard,
  isPenaltyCard,
  numberValue,
  penaltyValue,
  PERFECT_BONUS,
  RunnerState,
  TURBO,
} from "./types";

// ---------------------------------------------------------------------------
// Lane readers — the lane holds real cards, everything else is derived from it
// so the two can never fall out of sync.
// ---------------------------------------------------------------------------

export const laneNumbers = (runner: RunnerState): number[] =>
  runner.lane.flatMap((c) => {
    const value = numberValue(c.code);
    return value === null ? [] : [value];
  });

export const numberCount = (runner: RunnerState): number =>
  runner.lane.reduce((n, c) => (isNumberCard(c.code) ? n + 1 : n), 0);

/**
 * Whether the lane already holds that number — the duplicate check the whole
 * game turns on. Goes through `numberValue`, so Le Mur collides with a plain 7
 * and the Dossard fétiche with a plain 13.
 */
export const hasNumber = (runner: RunnerState, value: number): boolean =>
  runner.lane.some((c) => numberValue(c.code) === value);

/** How many cards of that value the lane holds (the Dossard fétiche allows 2). */
export const countNumber = (runner: RunnerState, value: number): number =>
  runner.lane.reduce((n, c) => (numberValue(c.code) === value ? n + 1 : n), 0);

export const holdsCard = (runner: RunnerState, code: number): boolean =>
  runner.lane.some((c) => c.code === code);

export const hasTurbo = (runner: RunnerState): boolean =>
  runner.lane.some((c) => c.code === TURBO);

export const laneBonuses = (runner: RunnerState): number[] =>
  runner.lane.flatMap((c) => (isBonusCard(c.code) ? [bonusValue(c.code)] : []));

export const lanePenalties = (runner: RunnerState): number[] =>
  runner.lane.flatMap((c) => (isPenaltyCard(c.code) ? [penaltyValue(c.code)] : []));

/**
 * What a lane is worth.
 *
 * One function for both rulesets, because the two decks never share a card:
 * a Turbo only ever sits in a classique lane, a Coup de barre only ever in a
 * Coups bas one. So the order below reads as the union of the two rules, and
 * each ruleset only ever exercises its own half.
 *
 *   numbers → ×2 (Turbo) → ÷2 (Coup de barre, rounded down)
 *           → + bonuses − penalties → floor at 0 → +15 for a Sprint parfait
 *
 * `brutal` is the Nuit noire option: it lifts the floor, so a race can end
 * below zero.
 */
export const laneScore = (runner: RunnerState, brutal = false): number => {
  // A cramped lane is worth nothing — but Nuit noire lets a penalty be piled
  // onto one, and a penalty nobody can feel would be no penalty at all.
  if (runner.status === "cramped") {
    if (!brutal) return 0;
    return -lanePenalties(runner).reduce((sum, v) => sum + v, 0);
  }

  let total = laneNumbers(runner).reduce((sum, v) => sum + v, 0);
  if (hasTurbo(runner)) total *= 2;
  if (holdsCard(runner, COUP_DE_BARRE)) total = Math.floor(total / 2);

  total += laneBonuses(runner).reduce((sum, v) => sum + v, 0);
  total -= lanePenalties(runner).reduce((sum, v) => sum + v, 0);

  // The Faux départ condemns the race to nothing — unless its holder redeems
  // it with a Sprint parfait, in which case the lane scores normally.
  if (holdsCard(runner, FAUX_DEPART) && !runner.perfect) return 0;

  if (!brutal) total = Math.max(0, total);
  return total + (runner.perfect ? PERFECT_BONUS : 0);
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
