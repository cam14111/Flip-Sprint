// What happens to a lane when a card lands in it.
//
// Split out of the engine because a card does not only arrive by being drawn:
// in Coups bas it can be stolen or swapped in, and the specification is
// explicit that those count as real receptions — they can cramp a lane, and a
// special card keeps its power under its new owner. Having one function for
// all three routes is what makes that true by construction rather than by
// three copies staying in step.

import { countNumber, holdsCard, numberCount } from "./scoring";
import { patchRunner, toDiscard, withEvent } from "./state";
import {
  Card,
  DOSSARD_FETICHE,
  GameState,
  isNumberCard,
  LE_MUR,
  numberValue,
  PERFECT_COUNT,
  RunnerState,
} from "./types";

/**
 * Whether taking `card` collapses this lane.
 *
 * Two Coups bas cards bend the duplicate rule, and both are settled here so
 * that nothing downstream has to know about them:
 *
 * - **Le Mur** never cramps. Its power — wiping the lane — takes priority, so
 *   a runner already holding a 7 is purged rather than cramped. A plain 7 taken
 *   *afterwards* is an ordinary duplicate and does cramp.
 * - The **Dossard fétiche** lets its holder carry exactly one extra 13, in
 *   either order. A third 13 cramps like anything else.
 */
export const cramps = (runner: RunnerState, card: Card): boolean => {
  const value = numberValue(card.code);
  if (value === null) return false;
  if (card.code === LE_MUR) return false;

  const already = countNumber(runner, value);
  if (already === 0) return false;

  if (value === 13 && already === 1) {
    const fetiche =
      holdsCard(runner, DOSSARD_FETICHE) || card.code === DOSSARD_FETICHE;
    if (fetiche) return false;
  }
  return true;
};

/**
 * Whether a lane holds an illegal duplicate *as it stands*.
 *
 * `cramps` asks the question one card at a time, which is the right shape when
 * a card is drawn. A Relais moves two cards at once and must be settled
 * atomically — it may cramp both runners — so the two lanes are judged after
 * the swap rather than during it. Returns the offending value, or null.
 */
export const laneDuplicate = (runner: RunnerState): number | null => {
  const seen = new Map<number, number>();
  for (const card of runner.lane) {
    const value = numberValue(card.code);
    if (value === null) continue;
    seen.set(value, (seen.get(value) ?? 0) + 1);
  }
  const allowance = holdsCard(runner, DOSSARD_FETICHE) ? 13 : null;
  for (const [value, count] of seen) {
    const limit = value === allowance ? 2 : 1;
    if (count > limit) return value;
  }
  return null;
};

/**
 * Sends a lane to the discard and marks it cramped.
 *
 * The lane is snapshotted on the way out: by scoring time the cards are long
 * gone, and the end-of-race recap still has to show what was lost. `incoming`
 * is the card that caused it when it is not in the lane yet — on a draw it
 * belongs in the snapshot too, whereas a Relais has already put it there.
 */
export const crampLane = (
  state: GameState,
  seat: number,
  value: number,
  incoming?: Card
): GameState => {
  const runner = state.players[seat];
  const lost = incoming ? [...runner.lane, incoming] : runner.lane;
  let s = toDiscard(state, lost);
  s = patchRunner(s, seat, (r) => ({
    ...r,
    lastLane: lost.map((c) => c.code),
    lane: [],
    status: "cramped",
  }));
  return withEvent(s, { type: "cramp", seat, value });
};

/**
 * A card arriving in a lane, by whatever route: drawn, stolen, or swapped in.
 * Resolves Le Mur, the duplicate rule, the Second souffle and the Sprint
 * parfait — everything that depends on the lane rather than on the turn.
 */
export const receive = (
  state: GameState,
  seat: number,
  card: Card
): GameState => {
  const runner = state.players[seat];

  // Penalties and anything else that is not a number simply join the lane.
  if (!isNumberCard(card.code)) {
    return patchRunner(state, seat, (r) => ({ ...r, lane: [...r.lane, card] }));
  }

  if (card.code === LE_MUR) {
    let s = toDiscard(state, runner.lane);
    s = patchRunner(s, seat, (r) => ({ ...r, lane: [card] }));
    return withEvent(s, { type: "wall", seat });
  }

  if (cramps(runner, card)) {
    if (runner.secondWind) {
      // Both the duplicate and the Second souffle leave play; the runner keeps
      // going. Usable mid-Rafale, unlike the other action cards.
      const spent = runner.secondWind;
      let s = patchRunner(state, seat, (r) => ({ ...r, secondWind: null }));
      s = toDiscard(s, [card, spent]);
      return withEvent(s, {
        type: "secondWindUsed",
        seat,
        value: numberValue(card.code) ?? card.code,
      });
    }
    // Crampe: the lane is worth nothing and every card in it leaves play.
    return crampLane(state, seat, numberValue(card.code) ?? card.code, card);
  }

  let s = patchRunner(state, seat, (r) => ({ ...r, lane: [...r.lane, card] }));
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
};
