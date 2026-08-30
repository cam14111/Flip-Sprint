// The online mode's load-bearing claim: (log) → state is deterministic, so
// every device lands on the same board. These tests hold the replay against
// the local engine playing the very same game.

import { describe, expect, it } from "vitest";
import { createGame, dealNextRound, legalTargets, reduce } from "@/game/engine";
import { makeRng, randomAction } from "@/game/test-utils";
import { GameState } from "@/game/types";
import { OnlineAction } from "./protocol";
import { CourseInput, replayCourse, ReplayConfig, replayGame } from "./replay";

/** Everything a replay must reproduce. The deck itself stays secret, and the
 *  RNG seed only matters if the deck ever runs dry, so both are left out. */
const observable = (state: GameState) => ({
  players: state.players,
  turnSeat: state.turnSeat,
  actor: state.actor,
  phase: state.phase,
  burstLeft: state.burstLeft,
  deferred: state.deferred,
  burstQueue: state.burstQueue,
  pendingAssign: state.pendingAssign,
  discard: state.discard,
  round: state.round,
});

/**
 * Plays a game locally and records the log a client would have written —
 * including, for every card taken, the code it disclosed.
 */
const recordGame = (
  seed: number,
  playerCount: number,
  courses: number
): { config: ReplayConfig; inputs: CourseInput[]; finals: GameState[] } => {
  const names = Array.from({ length: playerCount }, (_, i) => `J${i + 1}`);
  const config: ReplayConfig = {
    names,
    scoreLimit: 200,
    roundLimit: null,
    playerCount,
  };

  let state = createGame({ names, seed, scoreLimit: 200, mode: "online" });
  const rand = makeRng(seed);
  const inputs: CourseInput[] = [];
  const finals: GameState[] = [];

  for (let course = 1; course <= courses; course++) {
    const actions: OnlineAction[] = [];

    for (let step = 0; step < 5000; step++) {
      if (state.phase === "roundOver" || state.phase === "gameOver") break;
      const targets = legalTargets(state);
      const action = randomAction(state, targets, rand);
      const seat = state.actor;

      // This is the peek the real client performs: read the one card it is
      // about to take, and publish its code inside the action.
      const online: OnlineAction =
        action.type === "hit"
          ? {
              seat,
              type: "hit",
              ref: state.deck[0].id,
              value: state.deck[0].code,
            }
          : action.type === "stay"
            ? { seat, type: "stay" }
            : action.type === "assign"
              ? { seat, type: "assign", target: action.target }
              : { seat, type: "assign", target: 0 };

      const next = reduce(state, action);
      if (next === state) throw new Error("legal action rejected");
      state = next;
      actions.push(online);
    }

    inputs.push({ course, actions });
    finals.push(state);
    if (state.phase === "gameOver") break;
    state = dealNextRound(state);
  }

  return { config, inputs, finals };
};

describe("le rejeu reproduit exactement la partie", () => {
  it("course par course, de 2 à 8 coureurs", () => {
    for (let playerCount = 2; playerCount <= 8; playerCount++) {
      for (let seed = 1; seed <= 25; seed++) {
        const { config, inputs, finals } = recordGame(
          seed * 7477 + playerCount,
          playerCount,
          4
        );

        let previous: GameState | null = null;
        inputs.forEach((input, i) => {
          const result = replayCourse(previous, config, input);
          expect(result.corrupted).toBe(false);
          expect(observable(result.state)).toEqual(observable(finals[i]));
          previous = result.state;
        });
      }
    }
  }, 120_000);

  it("sur la partie entière d'un coup", () => {
    const { config, inputs, finals } = recordGame(4242, 4, 5);
    const result = replayGame(config, inputs);
    expect(result.corrupted).toBe(false);
    expect(observable(result.state)).toEqual(
      observable(finals[finals.length - 1])
    );
  });

  it("suit le curseur de pioche", () => {
    const { config, inputs } = recordGame(31, 3, 1);
    const result = replayCourse(null, config, inputs[0]);
    const hits = inputs[0].actions.filter((a) => a.type === "hit").length;
    expect(result.draws).toBe(hits);
    expect(result.cursorRef).toBe(`d/${hits}`);
  });
});

describe("le rejeu détecte un journal trafiqué", () => {
  const base = () => recordGame(99, 3, 1);

  it("refuse une valeur de carte inventée", () => {
    const { config, inputs } = base();
    const actions = inputs[0].actions.slice();
    const index = actions.findIndex((a) => a.type === "hit");
    // Une valeur mensongère finit par produire un coup impossible : soit le
    // moteur la rejette, soit l'état diverge de celui des autres appareils.
    actions[index] = { ...actions[index], value: 12 };
    const tampered = replayCourse(null, config, { course: 1, actions });
    const honest = replayCourse(null, config, inputs[0]);
    const diverged =
      tampered.corrupted ||
      JSON.stringify(observable(tampered.state)) !==
        JSON.stringify(observable(honest.state));
    expect(diverged).toBe(true);
  });

  it("refuse un coup joué par un autre siège", () => {
    const { config, inputs } = base();
    const actions = inputs[0].actions.slice();
    const seat = actions[0].seat;
    actions[0] = { ...actions[0], seat: (seat + 1) % 3 };
    expect(replayCourse(null, config, { course: 1, actions }).corrupted).toBe(
      true
    );
  });

  it("refuse une attribution vers une cible illégale", () => {
    const { config, inputs } = base();
    const actions = inputs[0].actions.slice();
    const index = actions.findIndex((a) => a.type === "assign");
    if (index === -1) return; // ce tirage n'a pas sorti de carte action
    actions[index] = { ...actions[index], target: 7 };
    expect(replayCourse(null, config, { course: 1, actions }).corrupted).toBe(
      true
    );
  });

  it("refuse une référence de carte qui n'est pas celle du dessus", () => {
    const { config, inputs } = base();
    const actions = inputs[0].actions.slice();
    const index = actions.findIndex((a) => a.type === "hit");
    actions[index] = { ...actions[index], ref: "d/77" };
    expect(replayCourse(null, config, { course: 1, actions }).corrupted).toBe(
      true
    );
  });
});

describe("les abandons voyagent dans le journal", () => {
  it("s'appliquent au même point de la séquence sur tous les appareils", () => {
    const { config, inputs } = recordGame(555, 4, 1);
    const actions = inputs[0].actions.slice(0, 8);
    actions.push({ seat: 2, type: "forfeit" });

    const first = replayCourse(null, config, { course: 1, actions });
    const second = replayCourse(null, config, { course: 1, actions });

    expect(first.corrupted).toBe(false);
    expect(first.state.players[2].out).toBe(true);
    expect(observable(first.state)).toEqual(observable(second.state));
  });

  it("refuse un second abandon du même siège", () => {
    const { config, inputs } = recordGame(555, 4, 1);
    const actions = inputs[0].actions.slice(0, 8);
    actions.push({ seat: 2, type: "forfeit" });
    actions.push({ seat: 2, type: "forfeit" });
    expect(replayCourse(null, config, { course: 1, actions }).corrupted).toBe(
      true
    );
  });
});
