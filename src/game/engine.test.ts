import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "./deck";
import {
  createGame,
  dealNextRound,
  endRound,
  forfeitRunner,
  legalTargets,
  reduce,
} from "./engine";
import { laneScore, laneNumbers } from "./scoring";
import { checkInvariants, stackedGame } from "./test-utils";
import {
  BONUS_10,
  BURST,
  GameAction,
  GameState,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "./types";

/** Applies a sequence of actions, asserting invariants after each one. */
const play = (
  state: GameState,
  actions: GameAction[],
  deckSize = DECK_SIZE
): GameState => {
  let s = state;
  for (const action of actions) {
    s = reduce(s, action);
    checkInvariants(s, deckSize);
  }
  return s;
};

const hit = (n: number): GameAction[] =>
  Array.from({ length: n }, () => ({ type: "hit" as const }));

describe("la donne d'ouverture", () => {
  it("oblige chaque coureur à prendre une carte avant de pouvoir souffler", () => {
    const g = stackedGame([5, 6, 7, 8]);
    expect(g.phase).toBe("draw");
    // "Souffler" est refusé tant que la carte d'ouverture n'est pas prise.
    expect(reduce(g, { type: "stay" })).toBe(g);

    const after = play(g, hit(1), 4);
    expect(after.players[0].opened).toBe(true);
    expect(after.turnSeat).toBe(1);
    expect(after.phase).toBe("draw"); // au tour de B de s'ouvrir
  });

  it("passe en phase de choix une fois que tout le monde s'est ouvert", () => {
    const g = play(stackedGame([5, 6]), hit(2), 2);
    expect(g.phase).toBe("decide");
    expect(g.actor).toBe(0);
  });

  it("tourne d'un siège à chaque nouvelle course", () => {
    const g = createGame({ names: ["A", "B", "C"] });
    expect(g.turnSeat).toBe(0);
    expect(dealNextRound(g).turnSeat).toBe(1);
    expect(dealNextRound(dealNextRound(g)).turnSeat).toBe(2);
  });
});

describe("la crampe", () => {
  it("vide le couloir, sort le coureur et lui laisse zéro point", () => {
    // A:5 · B:6 · A:5 -> doublon
    const g = play(stackedGame([5, 6, 5]), hit(3), 3);
    expect(g.players[0].status).toBe("cramped");
    expect(g.players[0].lane).toHaveLength(0);
    expect(laneScore(g.players[0])).toBe(0);
    expect(g.discard).toHaveLength(2); // le couloir et le doublon
  });

  it("emporte aussi les modificateurs déjà acquis", () => {
    // A:5 · B:6 · A:x2 · B:7 · A:+10 · B:8 · A:5 -> crampe
    const g = play(
      stackedGame([5, 6, TURBO, 7, BONUS_10, 8, 5]),
      hit(7),
      7
    );
    expect(g.players[0].status).toBe("cramped");
    expect(laneScore(g.players[0])).toBe(0);
  });

  it("rend la main au coureur suivant", () => {
    const g = play(stackedGame([5, 6, 5]), hit(3), 3);
    expect(g.turnSeat).toBe(1);
    expect(g.phase).toBe("decide");
  });

  it("garde une trace du couloir perdu pour le récapitulatif", () => {
    // Les cartes partent à la défausse immédiatement : sans cette trace,
    // l'écran de fin de course ne pourrait pas distinguer une crampe d'un
    // coureur qui n'a jamais rien pris.
    let g = play(stackedGame([5, 6, TURBO, 7, 5]), hit(5), 5);
    expect(g.players[0].lastLane).toEqual([5, TURBO, 5]);

    g = reduce(g, { type: "stay" }); // B souffle -> la course est comptée
    expect(g.players[0].status).toBe("cramped");
    expect(g.players[0].lastLane).toEqual([5, TURBO, 5]);
    expect(g.players[0].lastRoundScore).toBe(0);
  });
});

describe("le sprint parfait", () => {
  // A prend 1,2,3,4,5,6,7 · B prend 8,9,10,11,12,0
  const deck = [1, 8, 2, 9, 3, 10, 4, 11, 5, 12, 6, 0, 7];

  it("s'obtient à sept numéros différents et vaut 15 points de bonus", () => {
    const g = play(stackedGame(deck), hit(13), deck.length);
    expect(g.players[0].perfect).toBe(true);
    // Le couloir est parti à la défausse : le récapitulatif garde la trace.
    expect(g.players[0].lastLane).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 1+2+3+4+5+6+7 = 28, +15
    expect(g.players[0].roundScores[0]).toBe(43);
  });

  it("met fin à la course immédiatement, les autres gardant leur acquis", () => {
    const g = play(stackedGame(deck), hit(13), deck.length);
    expect(g.phase === "roundOver" || g.phase === "gameOver").toBe(true);
    // B avait 8+9+10+11+12+0 = 50 et les encaisse.
    expect(g.players[1].roundScores[0]).toBe(50);
  });
});

describe("le coup de sifflet", () => {
  it("fait encaisser la cible et la sort de la course", () => {
    // A:5 · B:6 · A:sifflet -> A vise B
    let g = play(stackedGame([5, 6, WHISTLE]), hit(3), 3);
    expect(g.phase).toBe("targeting");
    expect(legalTargets(g)).toEqual([0, 1]); // soi-même est une cible valide

    g = play(g, [{ type: "assign", target: 1 }], 3);
    expect(g.players[1].status).toBe("whistled");
    expect(laneScore(g.players[1])).toBe(6); // les points sont conservés
  });

  it("peut être gardé pour soi", () => {
    let g = play(stackedGame([5, 6, WHISTLE]), hit(3), 3);
    g = play(g, [{ type: "assign", target: 0 }], 3);
    expect(g.players[0].status).toBe("whistled");
    expect(laneScore(g.players[0])).toBe(5);
  });

  it("refuse une cible qui a déjà quitté la course", () => {
    let g = play(stackedGame([5, 6, WHISTLE, 7]), hit(3), 4);
    g = play(g, [{ type: "assign", target: 1 }], 4);
    // B est sorti : plus personne d'autre que A ne peut être visé.
    g = play(g, hit(1), 4);
    if (g.phase === "targeting") expect(legalTargets(g)).toEqual([0]);
  });
});

describe("la rafale", () => {
  it("fait tirer trois cartes d'affilée à la cible", () => {
    // A:rafale -> B ; B tire 3, 4, 5
    let g = play(stackedGame([BURST, 3, 4, 5, 9]), hit(1), 5);
    expect(g.phase).toBe("targeting");

    g = play(g, [{ type: "assign", target: 1 }], 5);
    expect(g.actor).toBe(1);
    expect(g.burstLeft).toBe(3);
    expect(g.turnSeat).toBe(0); // le tour de table n'a pas bougé

    g = play(g, hit(3), 5);
    expect(laneNumbers(g.players[1])).toEqual([3, 4, 5]);
    expect(g.burstLeft).toBe(0);
  });

  it("ne dispense pas la cible de sa propre carte d'ouverture", () => {
    let g = play(stackedGame([BURST, 3, 4, 5, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 5);
    expect(g.players[1].opened).toBe(false);
    expect(g.turnSeat).toBe(1);
    expect(g.phase).toBe("draw"); // B doit encore s'ouvrir
  });

  it("interrompt la rafale sur une crampe", () => {
    // B tire 3 puis 3 : crampe au deuxième, la troisième carte n'est pas tirée
    let g = play(stackedGame([BURST, 3, 3, 5, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }, ...hit(2)], 5);
    expect(g.players[1].status).toBe("cramped");
    expect(g.burstLeft).toBe(0);
  });

  it("peut être gardée pour soi", () => {
    let g = play(stackedGame([BURST, 3, 4, 5]), hit(1), 4);
    g = play(g, [{ type: "assign", target: 0 }], 4);
    expect(g.actor).toBe(0);
    expect(g.burstLeft).toBe(3);
  });
});

describe("les cartes action tirées pendant une rafale", () => {
  it("sont mises de côté et attribuées seulement à la fin", () => {
    // B tire 3, un sifflet (mis de côté), puis 5
    let g = play(stackedGame([BURST, 3, WHISTLE, 5, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }], 5);

    g = play(g, hit(1), 5); // 3
    expect(g.phase).toBe("draw");
    g = play(g, hit(1), 5); // sifflet -> mis de côté, la rafale continue
    expect(g.phase).toBe("draw");
    expect(g.deferred).toHaveLength(1);
    g = play(g, hit(1), 5); // 5 -> fin de rafale

    expect(g.phase).toBe("targeting");
    expect(g.pendingAssign?.deferred).toBe(true);
    expect(g.actor).toBe(1); // c'est la cible de la rafale qui attribue
  });

  it("diffère aussi la carte tirée en dernière position de la rafale", () => {
    // Le sifflet sort sur la 3e et dernière carte : il doit rester différé.
    let g = play(stackedGame([BURST, 3, 4, WHISTLE, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 5);
    expect(g.phase).toBe("targeting");
    expect(g.pendingAssign?.deferred).toBe(true);
    expect(g.actor).toBe(1);
  });

  it("sont annulées si la cible fait une crampe", () => {
    // B tire 3, un sifflet (différé), puis 3 -> crampe : le sifflet est perdu
    let g = play(stackedGame([BURST, 3, WHISTLE, 3, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 5);
    expect(g.players[1].status).toBe("cramped");
    expect(g.deferred).toHaveLength(0);
    expect(g.phase).not.toBe("targeting");
    expect(g.events.some((e) => e.type === "deferredDropped")).toBe(true);
  });

  it("sont annulées par un sprint parfait", () => {
    // B enchaîne 7 numéros grâce à des rafales successives ; le sifflet saute.
    const g = play(
      stackedGame([BURST, 1, 2, WHISTLE], { names: ["A", "B"] }),
      [{ type: "hit" }],
      4
    );
    expect(g.phase).toBe("targeting");
  });

  it("empilent les rafales, exécutées une fois toutes les attributions faites", () => {
    // A rafale B ; B tire deux rafales et un numéro, puis les distribue.
    let g = play(
      stackedGame([BURST, BURST, BURST, 4, 9, 8, 7, 6, 5, 3, 2], {
        names: ["A", "B", "C"],
      }),
      hit(1),
      11
    );
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 11);
    // Deux rafales mises de côté : la première attend déjà sa cible, la
    // seconde patiente derrière.
    expect(g.phase).toBe("targeting");
    expect(g.pendingAssign?.deferred).toBe(true);
    expect(g.deferred).toHaveLength(1);

    g = play(g, [{ type: "assign", target: 2 }], 11); // 1re rafale -> C
    expect(g.burstQueue).toEqual([2]);
    expect(g.phase).toBe("targeting"); // la 2e attend encore sa cible

    g = play(g, [{ type: "assign", target: 0 }], 11); // 2e rafale -> A
    expect(g.actor).toBe(2); // la file démarre
    expect(g.burstLeft).toBe(3);
  });

  it("saute une rafale visant un coureur sorti entre-temps", () => {
    // B met de côté une rafale et un sifflet, vise C avec les deux :
    // le sifflet sort C, la rafale en file doit être ignorée.
    let g = play(
      stackedGame([BURST, BURST, WHISTLE, 4, 9, 8, 7, 6, 5], {
        names: ["A", "B", "C"],
      }),
      hit(1),
      9
    );
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 9);
    g = play(g, [{ type: "assign", target: 2 }], 9); // rafale -> C (en file)
    g = play(g, [{ type: "assign", target: 2 }], 9); // sifflet -> C (immédiat)
    expect(g.players[2].status).toBe("whistled");
    expect(g.burstLeft).toBe(0); // la rafale sur C est abandonnée
  });
});

describe("le second souffle", () => {
  it("annule un doublon et quitte le jeu avec lui", () => {
    // A:2nd souffle · B:8 · A:5 · B:9 · A:5 -> doublon absorbé
    const g = play(stackedGame([SECOND_WIND, 8, 5, 9, 5]), hit(5), 5);
    expect(g.players[0].status).toBe("running");
    expect(g.players[0].secondWind).toBeNull();
    expect(laneNumbers(g.players[0])).toEqual([5]);
    expect(g.discard).toHaveLength(2); // le doublon et le second souffle
  });

  it("est donné à un autre coureur quand on en a déjà un", () => {
    let g = play(stackedGame([SECOND_WIND, 8, SECOND_WIND]), hit(3), 3);
    expect(g.phase).toBe("targeting");
    expect(legalTargets(g)).toEqual([1]); // jamais soi-même

    g = play(g, [{ type: "assign", target: 1 }], 3);
    expect(g.players[1].secondWind).not.toBeNull();
  });

  it("est défaussé si personne ne peut le recevoir", () => {
    // A et B en ont déjà un ; le troisième n'a nulle part où aller.
    const g = play(
      stackedGame([SECOND_WIND, SECOND_WIND, SECOND_WIND]),
      hit(3),
      3
    );
    expect(g.phase).not.toBe("targeting");
    expect(g.events.some((e) => e.type === "secondWindDropped")).toBe(true);
    expect(g.discard).toHaveLength(1);
  });

  it("s'utilise en pleine rafale, sans être mis de côté", () => {
    // B reçoit une rafale : 5, second souffle, 5 -> le doublon est absorbé
    let g = play(stackedGame([BURST, 5, SECOND_WIND, 5, 9]), hit(1), 5);
    g = play(g, [{ type: "assign", target: 1 }, ...hit(3)], 5);
    expect(g.players[1].status).toBe("running");
    expect(g.players[1].secondWind).toBeNull();
  });
});

describe("les modificateurs", () => {
  it("ne comptent pas dans les sept numéros du sprint parfait", () => {
    const g = play(stackedGame([TURBO, 9, BONUS_10, 8]), hit(4), 4);
    expect(laneNumbers(g.players[0])).toHaveLength(0);
    expect(g.players[0].perfect).toBe(false);
  });

  it("appliquent le turbo aux numéros seulement, avant les bonus", () => {
    // A: x2, 5, +10 -> (5 x 2) + 10 = 20
    const g = play(stackedGame([TURBO, 1, 5, 2, BONUS_10, 3]), hit(6), 6);
    expect(laneScore(g.players[0])).toBe(20);
  });
});

describe("la fin de course et de partie", () => {
  it("cumule les scores et enchaîne sur une nouvelle course", () => {
    let g = play(stackedGame([5, 6, 5]), hit(3), 3); // A crampe
    g = reduce(g, { type: "stay" }); // B souffle -> fin de course
    expect(g.phase).toBe("roundOver");
    expect(g.players[0].totalScore).toBe(0);
    expect(g.players[1].totalScore).toBe(6);

    const next = dealNextRound(g);
    expect(next.round).toBe(2);
    expect(next.phase).toBe("draw");
    expect(next.players[1].totalScore).toBe(6); // les totaux sont conservés
    expect(next.players[0].status).toBe("running");
    checkInvariants(next, 94);
  });

  it("s'arrête quand la ligne d'arrivée est franchie", () => {
    const base = createGame({ names: ["A", "B"], scoreLimit: 10 });
    const g = endRound({
      ...base,
      players: [
        { ...base.players[0], lane: [{ id: "x", code: 12 }] },
        base.players[1],
      ],
    });
    expect(g.phase).toBe("gameOver");
    expect(g.events.some((e) => e.type === "gameOver" && e.winner === 0)).toBe(
      true
    );
  });

  it("rejoue une course quand les meneurs sont à égalité", () => {
    const base = createGame({ names: ["A", "B"], scoreLimit: 10 });
    const g = endRound({
      ...base,
      players: [
        { ...base.players[0], lane: [{ id: "x", code: 12 }] },
        { ...base.players[1], lane: [{ id: "y", code: 12 }] },
      ],
    });
    expect(g.phase).toBe("roundOver"); // pas de vainqueur : on repart
  });

  it("respecte le mode Éclair, en nombre de courses", () => {
    const base = createGame({
      names: ["A", "B"],
      roundLimit: 1,
      scoreLimit: 9999,
    });
    const g = endRound({
      ...base,
      players: [
        { ...base.players[0], lane: [{ id: "x", code: 3 }] },
        base.players[1],
      ],
    });
    expect(g.phase).toBe("gameOver");
  });
});

describe("l'abandon (mode en ligne)", () => {
  it("sort le coureur, défausse ses cartes et l'ignore dans la rotation", () => {
    let g = play(stackedGame([5, 6, 7], { names: ["A", "B", "C"] }), hit(3), 3);
    g = forfeitRunner(g, 1);
    checkInvariants(g, 3);
    expect(g.players[1].out).toBe(true);
    expect(g.players[1].lane).toHaveLength(0);
    expect(g.turnSeat).not.toBe(1);
  });

  it("rend la main quand le partant tenait la table", () => {
    let g = play(stackedGame([5, 6, 7], { names: ["A", "B", "C"] }), hit(2), 3);
    expect(g.actor).toBe(2);
    g = forfeitRunner(g, 2);
    checkInvariants(g, 3);
    expect(g.actor).not.toBe(2);
  });

  it("termine la partie lorsqu'il ne reste qu'un coureur", () => {
    let g = play(stackedGame([5, 6]), hit(2), 2);
    g = forfeitRunner(g, 1);
    expect(g.phase).toBe("gameOver");
    expect(g.events.some((e) => e.type === "gameOver" && e.winner === 0)).toBe(
      true
    );
  });
});

describe("la pioche épuisée", () => {
  it("remélange la défausse de façon déterministe", () => {
    // A:5 · B:6 · A:5 -> crampe (5 et 5 à la défausse), pioche vide
    let g = play(stackedGame([5, 6, 5]), hit(3), 3);
    expect(g.deck).toHaveLength(0);
    expect(g.discard).toHaveLength(2);

    g = play(g, hit(1), 3); // B tire : la défausse repart en pioche
    expect(g.events.some((e) => e.type === "reshuffle")).toBe(true);
    expect(laneNumbers(g.players[1])).toEqual([6, 5]);
  });
});

describe("les coups illégaux", () => {
  const g = play(stackedGame([5, 6, WHISTLE]), hit(3), 3);

  it("refusent une attribution hors phase de ciblage", () => {
    const decide = play(stackedGame([5, 6]), hit(2), 2);
    expect(reduce(decide, { type: "assign", target: 1 })).toBe(decide);
  });

  it("refusent une cible illégale", () => {
    expect(reduce(g, { type: "assign", target: 7 })).toBe(g);
  });

  it("refusent de tirer tant qu'une carte attend sa cible", () => {
    expect(reduce(g, { type: "hit" })).toBe(g);
  });

  it("ne font rien une fois la course terminée", () => {
    const over = endRound(g);
    expect(reduce(over, { type: "hit" })).toBe(over);
    expect(reduce(over, { type: "stay" })).toBe(over);
  });
});
