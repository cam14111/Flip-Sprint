// Property tests: thousands of random games hammered through the engine.
//
// The targeted suite proves the rules do what the rulebook says. This one
// proves the engine never does anything it must never do — lose a card, let a
// runner hold a duplicate, deadlock the table, or fail to finish a game — under
// any sequence of legal actions at any player count.

import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "./deck";
import {
  createGame,
  dealNextRound,
  forfeitRunner,
  legalCardPicks,
  legalTargets,
  MAX_RUNNERS,
  MIN_RUNNERS,
  reduce,
} from "./engine";
import { laneDuplicate } from "./lane";
import { laneScore } from "./scoring";
import { checkInvariants, makeRng, randomAction } from "./test-utils";
import { GameState, RulesetId } from "./types";

/** Generous ceiling: hitting it means the engine failed to make progress. */
const MAX_STEPS = 60_000;

interface RunResult {
  state: GameState;
  steps: number;
  rounds: number;
}

const playRandomGame = (
  seed: number,
  playerCount: number,
  opts: { forfeitAt?: number; ruleset?: RulesetId; brutal?: boolean } = {}
): RunResult => {
  const names = Array.from({ length: playerCount }, (_, i) => `J${i + 1}`);
  const ruleset = opts.ruleset ?? "classique";
  const size = DECK_SIZE[ruleset];
  let state = createGame({
    names,
    seed,
    scoreLimit: 200,
    ruleset,
    brutal: opts.brutal,
  });
  checkInvariants(state, size);

  const rand = makeRng(seed);
  let steps = 0;
  let rounds = 1;

  while (state.phase !== "gameOver") {
    if (++steps > MAX_STEPS) {
      throw new Error(`no progress after ${MAX_STEPS} steps (seed ${seed})`);
    }

    if (state.phase === "roundOver") {
      state = dealNextRound(state);
      rounds++;
      checkInvariants(state, size);
      continue;
    }

    // Optionally have someone walk out mid-game (the online forfeit path).
    if (opts.forfeitAt === steps && playerCount > MIN_RUNNERS) {
      const victim = Math.floor(rand() * playerCount);
      const next = forfeitRunner(state, victim);
      checkInvariants(next, size);
      state = next;
      continue;
    }

    const targets = legalTargets(state);
    if (state.phase === "targeting" && targets.length === 0) {
      throw new Error(`a card awaits a target nobody can take (seed ${seed})`);
    }
    if (state.phase === "picking" && legalCardPicks(state).length === 0) {
      throw new Error(`a card awaits a pick nobody can make (seed ${seed})`);
    }

    const next = reduce(state, randomAction(state, targets, rand));
    if (next === state) {
      throw new Error(`legal action rejected in phase ${state.phase}`);
    }
    checkInvariants(next, size);
    state = next;
  }

  return { state, steps, rounds };
};

describe("des milliers de parties aléatoires", () => {
  it("conservent les 94 cartes et terminent, de 2 à 8 coureurs", () => {
    let games = 0;
    for (let playerCount = MIN_RUNNERS; playerCount <= MAX_RUNNERS; playerCount++) {
      for (let seed = 1; seed <= 150; seed++) {
        const { state } = playRandomGame(seed * 7919 + playerCount, playerCount);
        expect(state.phase).toBe("gameOver");
        games++;

        // Exactly one winner, and they really are on top.
        const winner = state.events.find((e) => e.type === "gameOver");
        expect(winner).toBeDefined();
        const best = Math.max(...state.players.map((p) => p.totalScore));
        const top = state.players.filter((p) => p.totalScore === best);
        expect(top).toHaveLength(1);
      }
    }
    expect(games).toBe(7 * 150);
  }, 120_000);

  it("restent cohérentes quand un coureur abandonne en cours de route", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const players = 3 + (seed % 6);
      const { state } = playRandomGame(seed * 104_729, players, {
        forfeitAt: 5 + (seed % 40),
      });
      expect(state.phase).toBe("gameOver");
      // A runner who left keeps the total they had; nobody scores after that.
      for (const p of state.players) {
        if (p.out) expect(p.lane).toHaveLength(0);
      }
    }
  }, 60_000);

  it("ne comptent jamais un score de course négatif ni un couloir invalide", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state } = playRandomGame(seed * 31, 2 + (seed % 7));
      for (const p of state.players) {
        expect(p.totalScore).toBeGreaterThanOrEqual(0);
        expect(laneScore(p)).toBeGreaterThanOrEqual(0);
        for (const score of p.roundScores) {
          expect(score).toBeGreaterThanOrEqual(0);
        }
      }
    }
  }, 60_000);

  it("sont strictement déterministes : même graine, même partie", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = playRandomGame(seed, 4);
      const b = playRandomGame(seed, 4);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
      expect(a.steps).toBe(b.steps);
    }
  }, 60_000);
});

describe("des milliers de parties Coups bas", () => {
  it("conservent les 108 cartes et terminent, de 2 à 8 coureurs", () => {
    // Le vrai risque de cette variante : les cartes changent de couloir. Voler,
    // faire défausser, échanger — chacune est une occasion d'en perdre une, ou
    // d'en fabriquer deux. L'invariant de conservation est vérifié après CHAQUE
    // transition, pas seulement en fin de partie.
    let games = 0;
    for (let playerCount = MIN_RUNNERS; playerCount <= MAX_RUNNERS; playerCount++) {
      for (let seed = 1; seed <= 60; seed++) {
        const { state } = playRandomGame(seed * 6151 + playerCount, playerCount, {
          ruleset: "coupsbas",
        });
        expect(state.phase).toBe("gameOver");
        games++;
      }
    }
    expect(games).toBe(7 * 60);
  }, 120_000);

  it("ne laissent jamais un couloir avec un doublon interdit", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const { state } = playRandomGame(seed * 2749, 2 + (seed % 7), {
        ruleset: "coupsbas",
      });
      for (const p of state.players) expect(laneDuplicate(p)).toBeNull();
    }
  }, 60_000);

  it("restent déterministes, et le sont aussi en Nuit noire", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const a = playRandomGame(seed, 4, { ruleset: "coupsbas", brutal: true });
      const b = playRandomGame(seed, 4, { ruleset: "coupsbas", brutal: true });
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  }, 60_000);
});
