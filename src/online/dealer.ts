// Where a course's deck order comes from.
//
// Isolated behind one function on purpose. Without a server, the client that
// creates a course is the one that shuffles it, and it therefore knows the
// deck order for a moment — in a push-your-luck game that knowledge would be
// worth a lot to a modified client. Flip Sprint accepts that trade for private
// races between people who know each other, and says so plainly in the README.
//
// Keeping the deal behind this single seam costs nothing today and means the
// day it should come from somewhere trusted (a Cloud Function), only this file
// and its one caller change.

import { dealDeck, randomSeed } from "@/game/deck";
import { CardCode } from "@/game/types";

export interface Deal {
  /** The `secrets/{code}/{course}` payload: { d: { 0: code, 1: code, … } }. */
  secrets: { d: Record<number, CardCode> };
}

/** Shuffles a fresh 94-card deck into the order a course will be dealt in. */
export const generateDeal = (): Deal => {
  const { cards } = dealDeck(randomSeed());
  const d: Record<number, CardCode> = {};
  cards.forEach((card, index) => {
    d[index] = card.code;
  });
  return { secrets: { d } };
};
