// The Coups bas rules, case by case.
//
// Every test here is a corner the specification calls out explicitly. They are
// written before the interface exists on purpose: these are the cases that
// decide whether the variant is the game it claims to be, and they are far
// easier to reason about as a stacked deck than as a screen.

import { describe, expect, it } from "vitest";
import { canStay, reduce } from "./engine";
import { laneScore } from "./scoring";
import { stackedGame } from "./test-utils";
import {
  CardCode,
  COUP_DE_BARRE,
  DOSSARD_FETICHE,
  FAUX_DEPART,
  GameState,
  LE_MUR,
  PENALTY_10,
  PENALTY_6,
  PERFECT_BONUS,
} from "./types";

/** A two-runner Coups bas game whose deck is exactly `codes`. */
const game = (codes: CardCode[], brutal = false): GameState =>
  stackedGame(codes, { ruleset: "coupsbas", brutal });

const hit = (g: GameState) => reduce(g, { type: "hit" });
const assign = (g: GameState, target: number) =>
  reduce(g, { type: "assign", target });

/** Values in a lane, in order, as the numbers they score as. */
const lane = (g: GameState, seat = 0) =>
  g.players[seat].lane.map((c) => c.code);

describe("Le Mur", () => {
  it("vide le couloir et reste seul", () => {
    // A prend 5 puis 9, puis Le Mur.
    let g = game([5, 1, 9, 1, LE_MUR]);
    g = hit(g); // A: 5
    g = hit(g); // B: 1
    g = hit(g); // A: 9
    expect(lane(g)).toEqual([5, 9]);
    g = hit(g); // B
    g = hit(g); // A: Le Mur
    expect(lane(g)).toEqual([LE_MUR]);
    expect(g.players[0].status).toBe("running");
  });

  it("est prioritaire sur le doublon : un 7 déjà posé ne fait pas cramper", () => {
    let g = game([7, 1, LE_MUR]);
    g = hit(g); // A: 7
    g = hit(g); // B: 1
    g = hit(g); // A: Le Mur — purge, pas crampe
    expect(g.players[0].status).toBe("running");
    expect(lane(g)).toEqual([LE_MUR]);
  });

  it("mais un 7 normal pris ENSUITE est bien un doublon", () => {
    let g = game([LE_MUR, 1, 7]);
    g = hit(g); // A: Le Mur
    g = hit(g); // B: 1
    g = hit(g); // A: 7 → doublon avec Le Mur
    expect(g.players[0].status).toBe("cramped");
  });

  it("emporte aussi les pénalités déjà subies", () => {
    let g = game([PENALTY_6, 1, LE_MUR]);
    g = hit(g); // A tire une pénalité : il doit la donner
    g = assign(g, 0); // il se la garde
    expect(lane(g)).toEqual([PENALTY_6]);
    g = hit(g); // B
    g = hit(g); // A: Le Mur
    expect(lane(g)).toEqual([LE_MUR]);
  });
});

describe("Le Dossard fétiche", () => {
  it("autorise un second 13, dans un sens", () => {
    let g = game([DOSSARD_FETICHE, 1, 13]);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    expect(g.players[0].status).toBe("running");
    expect(lane(g)).toEqual([DOSSARD_FETICHE, 13]);
  });

  it("et dans l'autre", () => {
    let g = game([13, 1, DOSSARD_FETICHE]);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    expect(g.players[0].status).toBe("running");
  });

  it("mais un troisième 13 fait cramper", () => {
    let g = game([DOSSARD_FETICHE, 1, 13, 1, 13]);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    expect(g.players[0].status).toBe("cramped");
  });

  it("ne protège pas d'un doublon d'une autre valeur", () => {
    let g = game([DOSSARD_FETICHE, 1, 4, 1, 4]);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    g = hit(g);
    expect(g.players[0].status).toBe("cramped");
  });

  it("les deux 13 comptent vers le Sprint parfait", () => {
    // Six valeurs distinctes seulement, mais sept cartes numéro.
    // B reçoit des valeurs toutes différentes : s'il crampait, l'ordre du tour
    // changerait et l'alternance ci-dessous ne tiendrait plus.
    let g = game([1, 2, 3, 4, 5, 6, 8, 7, 11, 9, 13, 10, DOSSARD_FETICHE]);
    for (let i = 0; i < 13; i++) g = hit(g);
    expect(g.players[0].perfect).toBe(true);
  });
});

describe("Le Faux départ", () => {
  it("interdit de souffler", () => {
    let g = game([FAUX_DEPART, 1, 4]);
    g = hit(g); // A: Faux départ
    g = hit(g); // B
    expect(g.actor).toBe(0);
    expect(g.phase).toBe("decide");
    expect(canStay(g)).toBe(false);
  });

  it("condamne le score de la manche à zéro", () => {
    let g = game([FAUX_DEPART, 1, 12]);
    g = hit(g);
    g = hit(g);
    g = hit(g); // A: 12
    expect(laneScore(g.players[0])).toBe(0);
  });

  it("sauf en cas de Sprint parfait, où le score redevient normal", () => {
    const g = game([]);
    const runner = {
      ...g.players[0],
      lane: [
        { id: "a", code: FAUX_DEPART },
        { id: "b", code: 1 },
        { id: "c", code: 2 },
        { id: "d", code: 3 },
        { id: "e", code: 4 },
        { id: "f", code: 5 },
        { id: "g", code: 6 },
      ],
      perfect: true,
    };
    expect(laneScore(runner)).toBe(21 + PERFECT_BONUS);
  });
});

describe("le calcul du score", () => {
  const withLane = (codes: CardCode[]) => ({
    ...game([]).players[0],
    lane: codes.map((code, i) => ({ id: `x${i}`, code })),
  });

  it("applique le Coup de barre AVANT les pénalités", () => {
    // 13 + 11 + 8 = 32 → ÷2 = 16 → −6 = 10
    const runner = withLane([13, 11, 8, COUP_DE_BARRE, PENALTY_6]);
    expect(laneScore(runner)).toBe(10);
  });

  it("ne descend pas sous zéro", () => {
    const runner = withLane([2, PENALTY_10]);
    expect(laneScore(runner)).toBe(0);
  });

  it("mais peut être négatif en Nuit noire", () => {
    const runner = withLane([2, PENALTY_10]);
    expect(laneScore(runner, true)).toBe(-8);
  });

  it("les pénalités ne comptent pas vers le Sprint parfait", () => {
    let g = game([1, 7, 2, 8, 3, 9, 4, 10, 5, 11, 6, 12, PENALTY_10]);
    for (let i = 0; i < 12; i++) g = hit(g);
    expect(g.players[0].perfect).toBe(false);
    g = hit(g); // A tire la pénalité — ce n'est pas un numéro
    expect(g.phase).toBe("targeting");
  });
});

describe("les pénalités", () => {
  it("peuvent être données à un coureur qui a soufflé", () => {
    let g = game([4, 5, 6, PENALTY_10]);
    g = hit(g); // A: 4
    g = hit(g); // B: 5
    g = hit(g); // A: 6
    g = reduce(g, { type: "stay" }); // B souffle
    expect(g.players[1].status).toBe("banked");
    g = hit(g); // A tire une pénalité
    expect(g.phase).toBe("targeting");
    // Souffler ne met plus à l'abri.
    expect(g.players[1].status).toBe("banked");
    g = assign(g, 1);
    expect(g.players[1].lane.map((c) => c.code)).toContain(PENALTY_10);
  });

  it("ne font jamais cramper", () => {
    let g = game([PENALTY_6, 1, PENALTY_6]);
    g = hit(g);
    g = assign(g, 0);
    g = hit(g); // B
    g = hit(g); // A: une deuxième pénalité identique
    g = assign(g, 0);
    expect(g.players[0].status).toBe("running");
  });
});
