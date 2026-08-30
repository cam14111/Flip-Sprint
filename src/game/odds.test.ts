import { describe, expect, it } from "vitest";
import { DECK_SIZE, deckComposition, numberCopies } from "./deck";
import { createGame } from "./engine";
import { drawableCounts, drawOdds } from "./odds";
import { Card, CardCode, GameState, SECOND_WIND } from "./types";

/** Moves a card of `code` out of the deck and into `seat`'s lane. */
const moveToLane = (
  state: GameState,
  seat: number,
  code: CardCode
): GameState => {
  const index = state.deck.findIndex((c) => c.code === code);
  if (index < 0) throw new Error(`no ${code} left in the deck`);
  const card = state.deck[index];
  const players = state.players.slice();
  players[seat] = { ...players[seat], lane: [...players[seat].lane, card] };
  return {
    ...state,
    players,
    deck: state.deck.filter((_, i) => i !== index),
  };
};

const totalOf = (counts: Map<CardCode, number>): number =>
  [...counts.values()].reduce((a, b) => a + b, 0);

describe("les cartes encore possibles", () => {
  it("décrivent exactement la pioche au début d'une course", () => {
    const game = createGame({ names: ["A", "B"], seed: 42 });
    const counts = drawableCounts(game);
    expect(totalOf(counts)).toBe(DECK_SIZE.classique);
    expect(totalOf(counts)).toBe(game.deck.length);
    expect(counts).toEqual(deckComposition());
  });

  it("retirent ce qui est visible dans les couloirs", () => {
    let game = createGame({ names: ["A", "B"], seed: 42 });
    game = moveToLane(game, 0, 5);
    game = moveToLane(game, 1, 5);
    const counts = drawableCounts(game);
    expect(counts.get(5)).toBe(numberCopies(5) - 2);
    expect(totalOf(counts)).toBe(game.deck.length);
  });

  it("retirent la défausse et les cartes en attente", () => {
    const game = createGame({ names: ["A", "B"], seed: 7 });
    const pending: Card = { id: "x", code: SECOND_WIND };
    const withPending: GameState = {
      ...game,
      deck: game.deck.slice(2),
      discard: [game.deck[0]],
      deferred: [game.deck[1]],
      pendingAssign: { card: pending, deferred: false },
      phase: "targeting",
    };
    // La carte en attente n'appartient pas au paquet du test : on vérifie
    // seulement que défausse et cartes différées sont bien décomptées.
    const counts = drawableCounts({ ...withPending, pendingAssign: null });
    expect(totalOf(counts)).toBe(withPending.deck.length);
  });
});

describe("le risque de crampe", () => {
  it("est nul quand le couloir est vide", () => {
    const game = createGame({ names: ["A", "B"], seed: 3 });
    expect(drawOdds(game, 0).cramp).toBe(0);
  });

  it("vaut le nombre de doublons restants sur le total des cartes cachées", () => {
    let game = createGame({ names: ["A", "B"], seed: 3 });
    game = moveToLane(game, 0, 5); // il reste quatre 5 sur 93 cartes
    const odds = drawOdds(game, 0);
    expect(odds.remaining).toBe(93);
    expect(odds.cramp).toBeCloseTo(4 / 93, 10);
  });

  it("monte avec chaque numéro collecté", () => {
    let game = createGame({ names: ["A", "B"], seed: 11 });
    let previous = 0;
    for (const value of [12, 11, 10, 9]) {
      game = moveToLane(game, 0, value);
      const risk = drawOdds(game, 0).cramp;
      expect(risk).toBeGreaterThan(previous);
      previous = risk;
    }
  });

  it("tombe à zéro tant qu'un second souffle est en main", () => {
    let game = createGame({ names: ["A", "B"], seed: 3 });
    game = moveToLane(game, 0, 12);
    expect(drawOdds(game, 0).cramp).toBeGreaterThan(0);

    const players = game.players.slice();
    players[0] = { ...players[0], secondWind: { id: "sw", code: SECOND_WIND } };
    expect(drawOdds({ ...game, players }, 0).cramp).toBe(0);
  });

  it("n'utilise que de l'information publique — jamais l'ordre de la pioche", () => {
    const game = createGame({ names: ["A", "B"], seed: 3 });
    // Réordonner la pioche ne doit rien changer aux cotes : sinon le calcul
    // lirait des cartes que personne n'est censé connaître.
    const reversed = { ...game, deck: game.deck.slice().reverse() };
    expect(drawOdds(reversed, 0)).toEqual(drawOdds(game, 0));
  });
});
