// The AI's tests are mostly about strength, not shape: a difficulty ladder is
// only worth having if the levels actually beat each other.

import { describe, expect, it } from "vitest";
import { decideAction, evaluateHit } from "./ai";
import { DECK_SIZE } from "./deck";
import {
  createGame,
  dealNextRound,
  legalTargets,
  reduce,
} from "./engine";
import { drawableCounts } from "./odds";
import { laneScore } from "./scoring";
import { checkInvariants, stackedGame } from "./test-utils";
import {
  BURST,
  Card,
  Difficulty,
  GameState,
  SECOND_WIND,
  WHISTLE,
} from "./types";

/** Plays a whole AI-only game and returns the final state. */
const playAiGame = (
  difficulties: Difficulty[],
  seed: number,
  scoreLimit = 200
): GameState => {
  // One engine-wide difficulty, so a mixed table is played one seat at a time
  // by swapping the field before each decision.
  let state = createGame({
    names: difficulties.map((d, i) => `${d}${i}`),
    aiSeats: difficulties.map((_, i) => i),
    seed,
    scoreLimit,
  });

  for (let step = 0; step < 40_000; step++) {
    if (state.phase === "gameOver") return state;
    if (state.phase === "roundOver") {
      state = dealNextRound(state);
      continue;
    }
    const view: GameState = { ...state, difficulty: difficulties[state.actor] };
    const action = decideAction(view, legalTargets(view));
    if (!action) throw new Error(`AI had no move in phase ${state.phase}`);
    const next = reduce(state, action);
    if (next === state) {
      throw new Error(`AI played an illegal ${action.type} in ${state.phase}`);
    }
    checkInvariants(next, DECK_SIZE.classique);
    state = next;
  }
  throw new Error("AI game never finished");
};

describe("l'IA joue toujours un coup légal", () => {
  it("de 2 à 8 coureurs, à tous les niveaux", () => {
    const levels: Difficulty[] = ["easy", "normal", "hard"];
    for (const difficulty of levels) {
      for (let players = 2; players <= 8; players++) {
        for (let seed = 1; seed <= 12; seed++) {
          const state = playAiGame(
            Array.from({ length: players }, () => difficulty),
            seed * 6151 + players
          );
          expect(state.phase).toBe("gameOver");
        }
      }
    }
  }, 120_000);
});

// Flip Sprint is a push-your-luck game, and a very lucky one: measured over
// 300 six-player games, all three levels won within a point of 1/6. Head-to-head
// duels are where skill actually shows, and even there the edge is modest —
// asserting a big win rate on a small sample would only be asserting variance.
// So these tests use large samples and claim what the numbers really support.
describe("la hiérarchie des niveaux", () => {
  /** Win rate of seat 0 over a series of head-to-head games. */
  const duel = (a: Difficulty, b: Difficulty, games: number): number => {
    let wins = 0;
    for (let seed = 1; seed <= games; seed++) {
      const state = playAiGame([a, b], seed * 97 + 13);
      const [p0, p1] = state.players;
      if (p0.totalScore > p1.totalScore) wins++;
    }
    return wins / games;
  };

  it("l'Expert bat le Débutant en duel", () => {
    // Mesuré à 56.3 % sur 400 parties ; le seuil laisse la place au bruit.
    expect(duel("hard", "easy", 400)).toBeGreaterThan(0.53);
  }, 180_000);

  it("l'Expert ne se fait pas dominer par le Confirmé", () => {
    // Mesuré à 52.3 %. L'écart est réel mais mince : le comptage exact vaut
    // peu sur un paquet de 94 cartes dont une poignée seulement est visible.
    expect(duel("hard", "normal", 400)).toBeGreaterThan(0.5);
  }, 180_000);

  it("le Confirmé bat le Débutant en duel", () => {
    expect(duel("normal", "easy", 400)).toBeGreaterThan(0.51);
  }, 180_000);
});

describe("les niveaux se comportent visiblement différemment", () => {
  /** Cramp rate and mean race score for one level, at a shared table. */
  const profile = (difficulties: Difficulty[], games: number) => {
    const cramps = difficulties.map(() => 0);
    const races = difficulties.map(() => 0);
    const points = difficulties.map(() => 0);

    for (let seed = 1; seed <= games; seed++) {
      let state = createGame({
        names: difficulties.map((d, i) => `${d}${i}`),
        aiSeats: difficulties.map((_, i) => i),
        seed: seed * 811 + 7,
        scoreLimit: 200,
      });
      const tally = () =>
        state.players.forEach((p, i) => {
          races[i]++;
          points[i] += p.lastRoundScore;
          if (p.status === "cramped") cramps[i]++;
        });

      for (let step = 0; step < 40_000; step++) {
        if (state.phase === "gameOver") break;
        if (state.phase === "roundOver") {
          tally();
          state = dealNextRound(state);
          continue;
        }
        const view = { ...state, difficulty: difficulties[state.actor] };
        const action = decideAction(view, legalTargets(view));
        if (!action) throw new Error("AI had no move");
        state = reduce(state, action);
      }
      tally();
    }

    return difficulties.map((_, i) => ({
      crampRate: cramps[i] / races[i],
      meanScore: points[i] / races[i],
    }));
  };

  it("le Débutant crampe bien plus souvent, et marque moins", () => {
    // C'est la différence que le joueur perçoit réellement, et elle est nette
    // là où les taux de victoire, eux, se noient dans la chance.
    const [beginner, , expert] = profile(["easy", "normal", "hard"], 120);
    expect(beginner.crampRate).toBeGreaterThan(expert.crampRate + 0.06);
    expect(expert.meanScore).toBeGreaterThan(beginner.meanScore);
  }, 180_000);
});

describe("l'espérance de gain", () => {
  it("chute quand le couloir se remplit de gros numéros", () => {
    let game = createGame({ names: ["A", "B"], seed: 5 });
    const before = evaluateHit(game, 0, drawableCounts(game));
    expect(before.crampChance).toBe(0);

    // Un couloir chargé en 12, 11, 10 : beaucoup à perdre, doublons fréquents.
    const lane: Card[] = [12, 11, 10].map((code, i) => ({
      id: `x${i}`,
      code,
    }));
    const players = game.players.slice();
    players[0] = { ...players[0], lane };
    game = { ...game, players };

    const after = evaluateHit(game, 0, drawableCounts(game));
    expect(after.crampChance).toBeGreaterThan(0.3);
    expect(after.current).toBe(33);
  });

  it("ignore le risque tant qu'un second souffle protège", () => {
    const game = createGame({ names: ["A", "B"], seed: 5 });
    const lane: Card[] = [{ id: "a", code: 12 }];
    const players = game.players.slice();
    players[0] = {
      ...players[0],
      lane,
      secondWind: { id: "sw", code: SECOND_WIND },
    };
    const guarded = { ...game, players };
    expect(evaluateHit(guarded, 0, drawableCounts(guarded)).crampChance).toBe(0);
  });
});

describe("les décisions de l'Expert", () => {
  const expert = (state: GameState): GameState => ({
    ...state,
    difficulty: "hard",
  });

  it("s'arrête quand souffler suffit à gagner la partie", () => {
    // A a 190 points et 20 en couloir : souffler franchit les 200 et personne
    // ne peut le rattraper.
    let game = expert(stackedGame([9, 3, 8], { scoreLimit: 200 }));
    game = reduce(game, { type: "hit" }); // A: 9
    game = reduce(game, { type: "hit" }); // B: 3
    const players = game.players.slice();
    players[0] = { ...players[0], totalScore: 195, isAI: true };
    players[1] = { ...players[1], totalScore: 40, isAI: true };
    const decisive = { ...game, players };

    expect(decideAction(decisive, [])).toEqual({ type: "stay" });
  });

  it("tente le sprint parfait à un numéro près", () => {
    // Six numéros au couloir : la septième carte vaut +15 et clôt la course.
    const base = createGame({
      names: ["A", "B"],
      aiSeats: [0, 1],
      seed: 3,
      scoreLimit: 200,
    });
    const lane: Card[] = [1, 2, 3, 4, 5, 6].map((code, i) => ({
      id: `n${i}`,
      code,
    }));
    const players = base.players.slice();
    players[0] = { ...players[0], lane, opened: true };
    const game = expert({ ...base, players, phase: "decide" });

    expect(decideAction(game, [])).toEqual({ type: "hit" });
  });

  it("siffle le coureur qui fait la meilleure course", () => {
    const base = createGame({
      names: ["A", "B", "C"],
      aiSeats: [0, 1, 2],
      seed: 9,
      scoreLimit: 200,
    });
    const players = base.players.slice();
    players[1] = { ...players[1], lane: [{ id: "b", code: 3 }] };
    players[2] = { ...players[2], lane: [{ id: "c", code: 12 }] };
    const game = expert({
      ...base,
      players,
      phase: "targeting",
      pendingAssign: { card: { id: "w", code: WHISTLE }, deferred: false },
    });

    expect(decideAction(game, legalTargets(game))).toEqual({
      type: "assign",
      target: 2, // C mène de loin
    });
  });

  it("rafale le coureur qui a le plus à perdre", () => {
    const base = createGame({
      names: ["A", "B", "C"],
      aiSeats: [0, 1, 2],
      seed: 9,
      scoreLimit: 200,
    });
    const players = base.players.slice();
    // B est chargé et très exposé aux doublons ; C n'a presque rien.
    players[1] = {
      ...players[1],
      lane: [12, 11, 10, 9].map((code, i) => ({ id: `b${i}`, code })),
    };
    players[2] = { ...players[2], lane: [{ id: "c", code: 1 }] };
    const game = expert({
      ...base,
      players,
      phase: "targeting",
      pendingAssign: { card: { id: "r", code: BURST }, deferred: false },
    });

    expect(decideAction(game, legalTargets(game))).toEqual({
      type: "assign",
      target: 1,
    });
  });

  it("donne le second souffle au coureur qui en profitera le moins", () => {
    const base = createGame({
      names: ["A", "B", "C"],
      aiSeats: [0, 1, 2],
      seed: 9,
      scoreLimit: 200,
    });
    const players = base.players.slice();
    players[0] = { ...players[0], secondWind: { id: "s0", code: SECOND_WIND } };
    players[1] = {
      ...players[1],
      lane: [12, 11].map((code, i) => ({ id: `b${i}`, code })),
    };
    players[2] = { ...players[2], lane: [{ id: "c", code: 1 }] };
    const game = expert({
      ...base,
      players,
      phase: "targeting",
      pendingAssign: { card: { id: "s", code: SECOND_WIND }, deferred: false },
    });

    expect(decideAction(game, legalTargets(game))).toEqual({
      type: "assign",
      target: 2, // C a le moins à protéger
    });
  });
});

describe("le Débutant se trompe visiblement", () => {
  it("continue même quand le couloir est brûlant", () => {
    const base = createGame({
      names: ["A", "B"],
      aiSeats: [0, 1],
      seed: 4,
      scoreLimit: 200,
    });
    const lane: Card[] = [12, 11, 10].map((code, i) => ({ id: `n${i}`, code }));
    const players = base.players.slice();
    players[0] = { ...players[0], lane, opened: true };
    const beginner: GameState = {
      ...base,
      players,
      phase: "decide",
      difficulty: "easy",
    };
    const pro: GameState = { ...beginner, difficulty: "hard" };

    expect(laneScore(beginner.players[0])).toBe(33);
    expect(decideAction(beginner, [])).toEqual({ type: "hit" });
    expect(decideAction(pro, [])).toEqual({ type: "stay" });
  });
});
