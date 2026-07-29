// React bridge over the pure engine.
//
// The engine stays ignorant of React, timers and I/O; everything with a side
// effect lives here — sounds, vibrations, saving the game, recording stats.

import { useCallback, useEffect, useRef, useState } from "react";
import { decideAction, thinkingDelay } from "@/game/ai";
import {
  createGame,
  CreateGameOptions,
  dealNextRound,
  legalTargets,
  reduce,
} from "@/game/engine";
import { clearGame, saveGame } from "@/game/persistence";
import { randomSeed } from "@/game/deck";
import {
  loadStats,
  recordGame,
  recordRace,
  saveStats,
  Stats,
} from "@/game/stats";
import { GameAction, GameEvent, GameState } from "@/game/types";
import { vibrate } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

/** Maps what just happened onto the game's sound and haptic language. */
const playEvents = (events: GameEvent[], humanSeat: number | null): void => {
  for (const event of events) {
    switch (event.type) {
      case "drew":
        playSound("draw");
        break;
      case "bonus":
        playSound("bonus");
        break;
      case "turbo":
        playSound("turbo");
        break;
      case "cramp":
        playSound("cramp");
        if (event.seat === humanSeat) vibrate("cramp");
        break;
      case "perfect":
        playSound("perfect");
        vibrate("win");
        break;
      case "whistled":
        playSound("whistle");
        if (event.seat === humanSeat) vibrate("whistle");
        break;
      case "burstStart":
        playSound("burst");
        break;
      case "banked":
        playSound("bank");
        break;
      case "secondWindUsed":
      case "secondWindGained":
        playSound("safe");
        break;
      case "gameOver":
        playSound(event.winner === humanSeat ? "perfect" : "bank");
        break;
      default:
        break;
    }
  }
};

export interface UseGame {
  game: GameState;
  stats: Stats;
  /** An AI runner is about to move — the board locks its buttons. */
  aiThinking: boolean;
  dispatch: (action: GameAction) => void;
  newGame: (options: CreateGameOptions) => GameState;
  nextRound: () => void;
  abandon: () => void;
}

/**
 * @param humanSeat Which seat the device belongs to (solo). `null` in local
 *        play, where every seat is a person in the room and stats stay neutral.
 * @param paused Freezes the AI loop while the board is off screen.
 */
export const useGame = (
  initial: GameState | null,
  humanSeat: number | null,
  paused = false
): UseGame => {
  const [game, setGame] = useState<GameState>(
    () => initial ?? createGame({ seed: randomSeed() })
  );
  const [stats, setStats] = useState<Stats>(() => loadStats());

  // Rounds and games must only ever be counted once, even though React may
  // render the same state twice (StrictMode, concurrent rendering).
  const countedRounds = useRef(new Set<string>());
  const countedGame = useRef<string | null>(null);

  const dispatch = useCallback(
    (action: GameAction) => setGame((current) => {
      const next = reduce(current, action);
      if (next !== current) playEvents(next.events, humanSeat);
      return next;
    }),
    [humanSeat]
  );

  const newGame = useCallback((options: CreateGameOptions) => {
    const fresh = createGame({ seed: randomSeed(), ...options });
    countedRounds.current = new Set();
    countedGame.current = null;
    setGame(fresh);
    saveGame(fresh);
    return fresh;
  }, []);

  const nextRound = useCallback(() => {
    setGame((current) =>
      current.phase === "roundOver" ? dealNextRound(current) : current
    );
  }, []);

  const abandon = useCallback(() => {
    clearGame();
  }, []);

  // Persist after every change so a reload lands exactly where we left off.
  useEffect(() => {
    saveGame(game);
  }, [game]);

  // --- AI runners --------------------------------------------------------
  // The move is decided from the state this effect saw, then applied on a
  // timer so it is watchable. The identity check inside setGame throws the
  // decision away if the board moved on in the meantime — which is what makes
  // it safe under StrictMode's double-invoked effects.
  const actor = game.players[game.actor];
  const aiTurn =
    !paused &&
    !!actor?.isAI &&
    (game.phase === "draw" ||
      game.phase === "decide" ||
      game.phase === "targeting");

  useEffect(() => {
    if (!aiTurn) return;
    const action = decideAction(game, legalTargets(game));
    if (!action) return;

    const timer = setTimeout(() => {
      setGame((current) => {
        if (current !== game) return current;
        const next = reduce(current, action);
        if (next !== current) playEvents(next.events, humanSeat);
        return next;
      });
    }, thinkingDelay(game));

    return () => clearTimeout(timer);
  }, [aiTurn, game, humanSeat]);

  // Record statistics once per race and once per game, for the human seat.
  useEffect(() => {
    if (humanSeat === null) return;
    const me = game.players[humanSeat];
    if (!me) return;

    if (game.phase === "roundOver" || game.phase === "gameOver") {
      const key = `${game.round}`;
      if (!countedRounds.current.has(key)) {
        countedRounds.current.add(key);
        setStats((s) =>
          saveStats(
            recordRace(s, {
              score: me.lastRoundScore,
              perfect: me.perfect,
              cramped: me.status === "cramped",
            })
          )
        );
      }
    }

    if (game.phase === "gameOver") {
      const gameKey = `${game.round}:${me.totalScore}`;
      if (countedGame.current !== gameKey) {
        countedGame.current = gameKey;
        const best = Math.max(
          ...game.players.filter((p) => !p.out).map((p) => p.totalScore)
        );
        setStats((s) =>
          saveStats(recordGame(s, me.totalScore === best, me.totalScore))
        );
      }
    }
  }, [game, humanSeat]);

  return { game, stats, aiThinking: aiTurn, dispatch, newGame, nextRound, abandon };
};

/** Exposed for the online bridge, which owns its own state pipeline. */
export { playEvents };
