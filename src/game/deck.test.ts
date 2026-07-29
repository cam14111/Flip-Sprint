import { describe, expect, it } from "vitest";
import {
  ACTION_CODES,
  ACTION_COPIES,
  buildDeck,
  dealDeck,
  DECK_SIZE,
  deckComposition,
  MODIFIER_CODES,
  numberCopies,
  shuffle,
} from "./deck";
import { isActionCard, isModifierCard, isNumberCard, MAX_NUMBER } from "./types";

describe("le paquet", () => {
  const deck = buildDeck();

  it("compte 94 cartes", () => {
    expect(deck).toHaveLength(DECK_SIZE);
  });

  it("contient 79 numéros : un 0, un 1, deux 2 … douze 12", () => {
    const numbers = deck.filter(isNumberCard);
    expect(numbers).toHaveLength(79);
    for (let v = 0; v <= MAX_NUMBER; v++) {
      expect(numbers.filter((c) => c === v)).toHaveLength(numberCopies(v));
    }
  });

  it("contient 6 modificateurs, un de chaque", () => {
    const modifiers = deck.filter(isModifierCard);
    expect(modifiers).toHaveLength(6);
    for (const code of MODIFIER_CODES) {
      expect(modifiers.filter((c) => c === code)).toHaveLength(1);
    }
  });

  it("contient 9 cartes action, trois de chaque", () => {
    const actions = deck.filter(isActionCard);
    expect(actions).toHaveLength(9);
    for (const code of ACTION_CODES) {
      expect(actions.filter((c) => c === code)).toHaveLength(ACTION_COPIES);
    }
  });

  it("expose une composition cohérente avec le paquet", () => {
    let total = 0;
    for (const [code, count] of deckComposition()) {
      total += count;
      expect(deck.filter((c) => c === code)).toHaveLength(count);
    }
    expect(total).toBe(DECK_SIZE);
  });
});

describe("le mélange", () => {
  it("est reproductible à graine égale — la condition du jeu en ligne", () => {
    const a = shuffle(buildDeck(), 12345);
    const b = shuffle(buildDeck(), 12345);
    expect(a.items).toEqual(b.items);
    expect(a.state).toBe(b.state);
  });

  it("donne un ordre différent à graine différente", () => {
    const a = shuffle(buildDeck(), 1);
    const b = shuffle(buildDeck(), 2);
    expect(a.items).not.toEqual(b.items);
  });

  it("est une permutation : aucune carte perdue ni dupliquée", () => {
    const { items } = shuffle(buildDeck(), 99);
    expect(items.slice().sort((x, y) => x - y)).toEqual(
      buildDeck().sort((x, y) => x - y)
    );
  });

  it("distribue des cartes dont l'id est la référence en ligne", () => {
    const { cards } = dealDeck(7);
    expect(cards).toHaveLength(DECK_SIZE);
    expect(cards[0].id).toBe("d/0");
    expect(cards[93].id).toBe("d/93");
  });
});
