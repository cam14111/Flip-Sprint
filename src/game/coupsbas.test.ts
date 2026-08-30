// The Coups bas rules, case by case.
//
// Every test here is a corner the specification calls out explicitly. They are
// written before the interface exists on purpose: these are the cases that
// decide whether the variant is the game it claims to be, and they are far
// easier to reason about as a stacked deck than as a screen.

import { describe, expect, it } from "vitest";
import { aiMustAct, decideAction } from "./ai";
import { canStay, legalCardPicks, legalTargets, reduce } from "./engine";
import { laneScore } from "./scoring";
import { stackedGame } from "./test-utils";
import {
  CardCode,
  COUP_DE_BARRE,
  DOSSARD_FETICHE,
  DRAFT,
  FAUX_DEPART,
  GameState,
  LAST_STRAIGHT,
  LE_MUR,
  PENALTY_10,
  PENALTY_6,
  PERFECT_BONUS,
  RELAY,
  SQUALL,
  STUMBLE,
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

// ---------------------------------------------------------------------------
// The five actions
// ---------------------------------------------------------------------------

const card = (id: string, code: CardCode) => ({ id, code });

/** A game posed by hand: some situations take a dozen draws to reach. */
const posed = (
  lanes: CardCode[][],
  pending: CardCode,
  extra: Partial<GameState> = {}
): GameState => {
  const g = game([]);
  return {
    ...g,
    players: lanes.map((codes, seat) => ({
      ...g.players[seat],
      lane: codes.map((code, i) => card(`p${seat}c${i}`, code)),
    })),
    actor: 0,
    phase: "picking",
    pendingAssign: { card: card("act", pending), deferred: false },
    ...extra,
  };
};

describe("Dernière ligne droite", () => {
  it("fait prendre une carte puis force à souffler", () => {
    let g = game([LAST_STRAIGHT, 1, 4]);
    g = hit(g); // A tire la carte action
    expect(g.phase).toBe("targeting");
    g = assign(g, 1); // sur B
    expect(g.actor).toBe(1);
    expect(g.phase).toBe("draw");
    g = hit(g); // B prend sa dernière carte
    expect(g.players[1].status).toBe("banked");
  });

  it("atteint un coureur qui avait déjà soufflé, sans le remettre en course", () => {
    const base = game([9]);
    let g: GameState = {
      ...base,
      players: [
        { ...base.players[0], opened: true },
        {
          ...base.players[1],
          opened: true,
          status: "banked",
          lane: [card("b0", 5)],
        },
      ],
      actor: 0,
      phase: "targeting",
      pendingAssign: { card: card("act", LAST_STRAIGHT), deferred: false },
    };
    g = assign(g, 1);
    expect(g.actor).toBe(1);
    g = hit(g); // B subit la carte forcée bien qu'il ait soufflé
    expect(g.players[1].lane.map((c) => c.code)).toContain(9);
    expect(g.players[1].status).toBe("banked");
  });
});

describe("Bourrasque", () => {
  it("fait prendre quatre cartes", () => {
    let g = game([SQUALL, 1, 2, 3, 4, 5]);
    g = hit(g);
    g = assign(g, 1);
    expect(g.burstLeft).toBe(4);
    for (let i = 0; i < 4; i++) g = hit(g);
    // B n'avait pas encore de carte d'ouverture : la Bourrasque lui en donne
    // quatre, et rien de plus.
    expect(g.players[1].lane).toHaveLength(4);
  });

  it("s'arrête net sur une crampe", () => {
    let g = game([SQUALL, 2, 3, 2, 9]);
    g = hit(g); // A tire la Bourrasque
    g = assign(g, 1); // B la subit
    g = hit(g); // B: 2
    g = hit(g); // B: 3
    g = hit(g); // B: 2 → crampe
    expect(g.players[1].status).toBe("cramped");
    expect(g.burstLeft).toBe(0);
  });
});

describe("Aspiration", () => {
  it("prend la carte choisie et la met dans son couloir", () => {
    let g = posed([[5], [12]], DRAFT, { pendingAssign: null });
    g = { ...g, pendingAssign: { card: card("act", DRAFT), deferred: false, target: 1 } };
    g = reduce(g, { type: "pick", ref: "p1c0" });
    expect(g.players[0].lane.map((c) => c.code)).toEqual([5, 12]);
    expect(g.players[1].lane).toHaveLength(0);
  });

  it("peut faire cramper le voleur", () => {
    let g = posed([[8], [8]], DRAFT);
    g = { ...g, pendingAssign: { card: card("act", DRAFT), deferred: false, target: 1 } };
    g = reduce(g, { type: "pick", ref: "p1c0" });
    expect(g.players[0].status).toBe("cramped");
  });

  it("voler Le Mur vide le couloir du voleur", () => {
    let g = posed([[5, 9], [LE_MUR]], DRAFT);
    g = { ...g, pendingAssign: { card: card("act", DRAFT), deferred: false, target: 1 } };
    g = reduce(g, { type: "pick", ref: "p1c0" });
    expect(g.players[0].lane.map((c) => c.code)).toEqual([LE_MUR]);
  });
});

describe("Faux pas", () => {
  it("retire la carte choisie", () => {
    let g = posed([[5], [12, 3]], STUMBLE);
    g = { ...g, pendingAssign: { card: card("act", STUMBLE), deferred: false, target: 1 } };
    g = reduce(g, { type: "pick", ref: "p1c0" });
    expect(g.players[1].lane.map((c) => c.code)).toEqual([3]);
  });

  it("défausser le Faux départ rend le droit de souffler", () => {
    let g = posed([[FAUX_DEPART, 4], [9]], STUMBLE);
    g = {
      ...g,
      players: g.players.map((p) => ({ ...p, opened: true })),
      actor: 1,
      pendingAssign: { card: card("act", STUMBLE), deferred: false, target: 0 },
    };
    g = reduce(g, { type: "pick", ref: "p0c0" });
    const decide = { ...g, actor: 0, phase: "decide" as const };
    expect(canStay(decide)).toBe(true);
  });
});

describe("Relais", () => {
  it("échange deux cartes entre deux couloirs", () => {
    let g = posed([[5], [12]], RELAY);
    g = reduce(g, { type: "pick", ref: "p0c0" });
    g = reduce(g, { type: "pick", ref: "p1c0" });
    expect(g.players[0].lane.map((c) => c.code)).toEqual([12]);
    expect(g.players[1].lane.map((c) => c.code)).toEqual([5]);
  });

  it("ne propose pas deux cartes du même couloir", () => {
    let g = posed([[5, 6], [12]], RELAY);
    g = reduce(g, { type: "pick", ref: "p0c0" });
    expect(legalCardPicks(g)).toEqual(["p1c0"]);
  });

  it("peut faire cramper LES DEUX coureurs d'un coup", () => {
    // A : 10, 11 — B : 10, 11. On échange le 10 de A contre le 11 de B.
    let g = posed([[10, 11], [10, 11]], RELAY);
    g = reduce(g, { type: "pick", ref: "p0c0" });
    g = reduce(g, { type: "pick", ref: "p1c1" });
    expect(g.players[0].status).toBe("cramped");
    expect(g.players[1].status).toBe("cramped");
  });
});

describe("Nuit noire — le Sprint parfait", () => {
  /** A game already in the bounty phase, with A having sprinted perfectly. */
  const sprinted = (): GameState => {
    const base = game([], true);
    const lane = [1, 2, 3, 4, 5, 6, 8].map((code, i) => card(`a${i}`, code));
    return {
      ...base,
      players: [
        { ...base.players[0], lane, perfect: true, status: "banked", totalScore: 40 },
        { ...base.players[1], totalScore: 80 },
      ],
      actor: 0,
      bounty: 0,
      phase: "bounty",
    };
  };

  it("laisse le choix entre le bonus et une frappe", () => {
    expect(sprinted().phase).toBe("bounty");
    // Se désigner soi-même garde le bonus ; désigner l'autre le donne en frappe.
    expect(legalTargets(sprinted())).toEqual([0, 1]);
  });

  it("se désigner soi-même garde les +15", () => {
    const g = assign(sprinted(), 0);
    expect(g.players[0].struck).toBeFalsy();
    expect(g.players[0].lastRoundScore).toBe(29 + PERFECT_BONUS);
    expect(g.players[1].lastRoundScore).toBe(0);
  });

  it("désigner un rival lui retire 15 — et coûte le bonus", () => {
    const g = assign(sprinted(), 1);
    expect(g.players[0].struck).toBe(true);
    // Plus de bonus pour l'auteur…
    expect(g.players[0].lastRoundScore).toBe(29);
    // …et quinze points de moins sur le total du rival.
    expect(g.players[1].lastRoundScore).toBe(-PERFECT_BONUS);
    expect(g.players[1].totalScore).toBe(80 - PERFECT_BONUS);
  });

  it("hors Nuit noire, le Sprint parfait ne pose aucune question", () => {
    // Valeurs toutes différentes pour B : s'il crampait, il sortirait de la
    // rotation et l'alternance un-coup-chacun ne tiendrait plus.
    let g = game([1, 7, 2, 9, 3, 10, 4, 11, 5, 12, 6, 13, 8]);
    for (let i = 0; i < 13; i++) g = hit(g);
    expect(g.players[0].perfect).toBe(true);
    expect(g.phase).not.toBe("bounty");
  });
});

describe("l'IA résout les cartes qui demandent de pointer", () => {
  // Signalé deux fois en jeu : le plateau se fige, l'IA « choisit une cible »
  // et ne choisit jamais. La première fois c'était le pilote React qui ne la
  // réveillait pas ; ce test-ci prend le problème par l'autre bout et vérifie
  // que, réveillée, elle sait effectivement conclure — Relais compris, qui est
  // la seule carte à demander DEUX désignations d'affilée.
  const aiTable = (pending: CardCode, lanes: CardCode[][]): GameState => {
    const base = game([]);
    return {
      ...base,
      players: lanes.map((codes, seat) => ({
        ...base.players[seat],
        isAI: true,
        lane: codes.map((code, i) => card(`p${seat}c${i}`, code)),
      })),
      actor: 0,
      phase: pending === RELAY ? "picking" : "targeting",
      pendingAssign: { card: card("act", pending), deferred: false },
    };
  };

  /** Plays the AI until the card in flight has been fully resolved. */
  const letAiFinish = (start: GameState): GameState => {
    let g = start;
    for (let i = 0; i < 10; i++) {
      // Every seat here is an AI, so "is it still the AI's turn?" would never
      // become false: what we are waiting on is the card being settled.
      if (g.pendingAssign === null) return g;
      expect(aiMustAct(g), `l'IA n'est pas sollicitée en ${g.phase}`).toBe(true);
      const action = decideAction(g, legalTargets(g));
      expect(action, `aucun coup en phase ${g.phase}`).not.toBeNull();
      const next = reduce(g, action!);
      expect(next, `coup illégal en phase ${g.phase}`).not.toBe(g);
      g = next;
    }
    throw new Error("l'IA n'en finit pas");
  };

  it("un Relais : deux cartes désignées, puis on avance", () => {
    const g = letAiFinish(aiTable(RELAY, [[4, 10], [11], [1, 11]]));
    expect(g.pendingAssign).toBeNull();
    expect(g.phase).not.toBe("picking");
  });

  it("une Aspiration : le coureur, puis la carte", () => {
    const g = letAiFinish(aiTable(DRAFT, [[4], [11], [1]]));
    expect(g.pendingAssign).toBeNull();
    expect(g.phase).not.toBe("picking");
  });

  it("un Faux pas : le coureur, puis la carte", () => {
    const g = letAiFinish(aiTable(STUMBLE, [[4], [11], [1]]));
    expect(g.pendingAssign).toBeNull();
    expect(g.phase).not.toBe("picking");
  });
});
