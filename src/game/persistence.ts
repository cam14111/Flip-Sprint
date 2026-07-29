// In-progress game persistence.
//
// A mobile PWA gets killed and reloaded constantly — backgrounded, memory
// pressure, an accidental refresh. Saving the whole state after every
// transition means "Reprendre la course" always works. The state is plain
// JSON-serialisable data, so a straight stringify round-trips it exactly.

import { ALL_PHASES, GameState } from "./types";

const KEY = "flip-sprint:game";
const VERSION = 1;

interface Envelope {
  version: number;
  state: GameState;
}

/** Structural check, so a corrupt or foreign blob can never crash the app. */
export const isValidGameState = (value: unknown): value is GameState => {
  if (!value || typeof value !== "object") return false;
  const g = value as GameState;
  return (
    (g.mode === "solo" || g.mode === "local") &&
    Array.isArray(g.players) &&
    g.players.length >= 2 &&
    g.players.every(
      (p) =>
        !!p &&
        typeof p.name === "string" &&
        typeof p.isAI === "boolean" &&
        Array.isArray(p.lane) &&
        Array.isArray(p.roundScores) &&
        typeof p.totalScore === "number"
    ) &&
    Array.isArray(g.deck) &&
    Array.isArray(g.discard) &&
    Array.isArray(g.deferred) &&
    Array.isArray(g.burstQueue) &&
    (ALL_PHASES as readonly string[]).includes(g.phase) &&
    typeof g.actor === "number" &&
    typeof g.turnSeat === "number" &&
    typeof g.rngState === "number"
  );
};

export const saveGame = (state: GameState): void => {
  try {
    // A finished game is not worth resuming.
    if (state.phase === "gameOver") {
      localStorage.removeItem(KEY);
      return;
    }
    const envelope: Envelope = { version: VERSION, state };
    localStorage.setItem(KEY, JSON.stringify(envelope));
  } catch {
    /* storage unavailable — the game simply won't survive a reload */
  }
};

export const loadGame = (): GameState | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed?.version !== VERSION) return null;
    return isValidGameState(parsed.state) ? parsed.state : null;
  } catch {
    return null;
  }
};

export const clearGame = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
