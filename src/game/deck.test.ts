import { describe, expect, it } from "vitest";
import {
  ACTION_CODES,
  ACTION_COPIES,
  buildDeck,
  COUPS_BAS_ACTION_CODES,
  COUPS_BAS_ACTION_COPIES,
  dealDeck,
  DECK_SIZE,
  deckComposition,
  MODIFIER_CODES,
  numberCopies,
  PENALTY_CODES,
  shuffle,
} from "./deck";
import {
  DOSSARD_FETICHE,
  FAUX_DEPART,
  HIGHEST_NUMBER,
  isActionCard,
  isCoupsBasAction,
  isModifierCard,
  isNumberCard,
  LE_MUR,
  MAX_NUMBER,
} from "./types";

describe("le paquet", () => {
  const deck = buildDeck();

  it("compte 94 cartes", () => {
    expect(deck).toHaveLength(DECK_SIZE.classique);
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
    expect(total).toBe(DECK_SIZE.classique);
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
    expect(cards).toHaveLength(DECK_SIZE.classique);
    expect(cards[0].id).toBe("d/0");
    expect(cards[93].id).toBe("d/93");
  });
});

describe("le paquet Coups bas", () => {
  const deck = buildDeck("coupsbas");
  const count = (code: number) => deck.filter((c) => c === code).length;

  it("compte 108 cartes", () => {
    expect(deck).toHaveLength(DECK_SIZE.coupsbas);
  });

  it("contient 92 numéros, de 0 à 13", () => {
    expect(deck.filter(isNumberCard)).toHaveLength(92);
    expect(count(HIGHEST_NUMBER)).toBeGreaterThan(0);
  });

  it("tire les trois cartes spéciales de l'allocation des numéros", () => {
    // Le Faux départ EST le seul 0 ; Le Mur est un des sept 7 ; le Dossard
    // fétiche est un des treize 13. Le total reste donc 92.
    expect(count(0)).toBe(0);
    expect(count(FAUX_DEPART)).toBe(1);

    expect(count(7)).toBe(numberCopies(7) - 1);
    expect(count(LE_MUR)).toBe(1);

    expect(count(13)).toBe(numberCopies(13) - 1);
    expect(count(DOSSARD_FETICHE)).toBe(1);
  });

  it("contient 6 pénalités, une de chaque", () => {
    for (const code of PENALTY_CODES) expect(count(code)).toBe(1);
    expect(deck.filter((c) => PENALTY_CODES.includes(c))).toHaveLength(6);
  });

  it("contient 10 cartes action, deux de chaque", () => {
    for (const code of COUPS_BAS_ACTION_CODES) {
      expect(count(code)).toBe(COUPS_BAS_ACTION_COPIES);
    }
    expect(deck.filter(isCoupsBasAction)).toHaveLength(10);
  });

  it("ne contient aucune carte du paquet classique", () => {
    expect(deck.some(isModifierCard)).toBe(false);
    for (const code of ACTION_CODES) expect(count(code)).toBe(0);
  });
});
