// The five Coups bas action cards.
//
// They are the reason this variant needed more than a new deck: each one moves
// a card between lanes or forces a runner to draw, and the specification calls
// out a corner for every single one of them. Kept apart from the engine so the
// classique rules stay as short as they were.

import { crampLane, laneDuplicate, receive } from "./lane";
import { patchRunner, toDiscard, withEvent } from "./state";
import {
  Card,
  DRAFT,
  GameState,
  LAST_STRAIGHT,
  LE_MUR,
  RELAY,
  STUMBLE,
} from "./types";

/** Cards drawn by the target of a Bourrasque. */
export const SQUALL_SIZE = 4;

/** Where a card currently sits, by the id it was dealt under ("d/17"). */
const findCard = (
  state: GameState,
  ref: string
): { seat: number; card: Card } | null => {
  for (let seat = 0; seat < state.players.length; seat++) {
    const card = state.players[seat].lane.find((c) => c.id === ref);
    if (card) return { seat, card };
  }
  return null;
};

const withoutCard = (state: GameState, seat: number, ref: string): GameState =>
  patchRunner(state, seat, (r) => ({
    ...r,
    lane: r.lane.filter((c) => c.id !== ref),
  }));

/**
 * Which cards the actor may point at right now.
 *
 * Everything in a lane is fair game — numbers, the three specials, penalties —
 * because that is exactly the point: a Faux pas can rid someone of their Faux
 * départ, and an Aspiration can hand you a Mur you did not want.
 */
export const legalPicks = (
  state: GameState,
  targets: (code: number) => number[]
): string[] => {
  const pending = state.pendingAssign;
  if (!pending || state.phase !== "picking") return [];
  const code = pending.card.code;

  if (code === RELAY) {
    const eligible = targets(RELAY);
    if (pending.firstRef === undefined) {
      return eligible.flatMap((seat) =>
        state.players[seat].lane.map((c) => c.id)
      );
    }
    // The second card has to come from a different lane — swapping a runner's
    // two cards with each other would be a no-op.
    const first = findCard(state, pending.firstRef);
    return eligible
      .filter((seat) => seat !== first?.seat)
      .flatMap((seat) => state.players[seat].lane.map((c) => c.id));
  }

  if (pending.target === undefined) return [];
  return state.players[pending.target].lane.map((c) => c.id);
};

/** True for the cards that need a lane pointed at before a card is chosen. */
export const needsCardPick = (code: number): boolean =>
  code === DRAFT || code === STUMBLE || code === RELAY;

/**
 * Hands out a Coups bas action once its target is known. Returns null when the
 * card is not one of these, so the caller can fall through to its own rules.
 */
export const assignCoupsBas = (
  state: GameState,
  card: Card,
  target: number,
  from: number
): GameState | null => {
  switch (card.code) {
    case LAST_STRAIGHT: {
      // One card, resolved in full — it may cramp them, or even be another
      // action — and only then are they made to stop. A runner who had already
      // caught their breath still takes the card, and stays stopped.
      const s = toDiscard(state, [card]);
      return withEvent(
        { ...s, actor: target, burstLeft: 1, mustBank: target, phase: "draw" },
        { type: "lastStraight", seat: target, by: from }
      );
    }
    case DRAFT:
    case STUMBLE:
      return {
        ...state,
        pendingAssign: { card, deferred: false, target },
        phase: "picking",
      };
    default:
      return null;
  }
};

/**
 * Resolves a card being pointed at. The caller has already checked that `ref`
 * is one of `legalPicks`.
 */
export const applyPick = (state: GameState, ref: string): GameState => {
  const pending = state.pendingAssign;
  if (!pending) return state;
  const { card } = pending;
  const found = findCard(state, ref);
  if (!found) return state;

  // --- Relais: two cards change lanes at once ------------------------------
  if (card.code === RELAY) {
    if (pending.firstRef === undefined) {
      return { ...state, pendingAssign: { ...pending, firstRef: ref } };
    }
    const first = findCard(state, pending.firstRef);
    if (!first || first.seat === found.seat) return state;

    let s = toDiscard({ ...state, pendingAssign: null }, [card]);
    s = withoutCard(s, first.seat, first.card.id);
    s = withoutCard(s, found.seat, found.card.id);
    s = patchRunner(s, first.seat, (r) => ({
      ...r,
      lane: [...r.lane, found.card],
    }));
    s = patchRunner(s, found.seat, (r) => ({
      ...r,
      lane: [...r.lane, first.card],
    }));

    // Le Mur wipes whichever lane it lands in, exactly as when it is drawn.
    for (const [seat, incoming] of [
      [first.seat, found.card],
      [found.seat, first.card],
    ] as const) {
      if (incoming.code !== LE_MUR) continue;
      const others = s.players[seat].lane.filter((c) => c.id !== incoming.id);
      s = toDiscard(s, others);
      s = patchRunner(s, seat, (r) => ({ ...r, lane: [incoming] }));
      s = withEvent(s, { type: "wall", seat });
    }

    s = withEvent(s, { type: "swapped", a: first.seat, b: found.seat });

    // The swap is settled first and judged afterwards, so a single Relais can
    // cramp BOTH runners — resolving one lane at a time would stop at the
    // first and quietly spare the second.
    const verdicts = [first.seat, found.seat].map((seat) => ({
      seat,
      value: laneDuplicate(s.players[seat]),
    }));
    for (const { seat, value } of verdicts) {
      if (value !== null) s = crampLane(s, seat, value);
    }
    return s;
  }

  // --- Aspiration: the card changes hands, and counts as a real reception ---
  if (card.code === DRAFT) {
    let s = toDiscard({ ...state, pendingAssign: null }, [card]);
    s = withoutCard(s, found.seat, found.card.id);
    s = withEvent(s, {
      type: "stolen",
      from: found.seat,
      to: state.actor,
      code: found.card.code,
    });
    // Straight through `receive`: stealing a number you already hold cramps
    // you, and stealing Le Mur wipes the lane you were so proud of.
    return receive(s, state.actor, found.card);
  }

  // --- Faux pas: the card is simply gone ------------------------------------
  if (card.code === STUMBLE) {
    let s = toDiscard({ ...state, pendingAssign: null }, [card]);
    s = withoutCard(s, found.seat, found.card.id);
    s = toDiscard(s, [found.card]);
    return withEvent(s, {
      type: "dropped",
      seat: found.seat,
      by: state.actor,
      code: found.card.code,
    });
  }

  return state;
};
