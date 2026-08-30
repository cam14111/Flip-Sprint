// User settings, persisted locally. No account, no server — one JSON blob in
// localStorage, merged over the defaults so an older save never breaks.

import { Difficulty, GameMode, RulesetId } from "./types";

/** How a game is won. Named after how it feels, not after a number. */
export type RaceMode = "sprint" | "eclair" | "marathon";

export interface RaceModeSpec {
  label: string;
  detail: string;
  scoreLimit: number;
  roundLimit: number | null;
}

export const RACE_MODES: Record<RaceMode, RaceModeSpec> = {
  eclair: {
    label: "Éclair",
    detail: "5 courses, le meilleur total gagne",
    scoreLimit: 99_999,
    roundLimit: 5,
  },
  sprint: {
    label: "Sprint",
    detail: "Premier à 200 points",
    scoreLimit: 200,
    roundLimit: null,
  },
  marathon: {
    label: "Marathon",
    detail: "Premier à 300 points",
    scoreLimit: 300,
    roundLimit: null,
  },
};

export const RACE_MODE_ORDER: RaceMode[] = ["eclair", "sprint", "marathon"];

export interface Settings {
  mode: GameMode;
  playerName: string;
  /** AI runners to face in solo (1-6). */
  soloOpponents: number;
  /** Humans sharing the device in local play (2-8). */
  localPlayers: number;
  localNames: string[];
  difficulty: Difficulty;
  raceMode: RaceMode;
  /** Which rules to play under. */
  ruleset: RulesetId;
  /** Coups bas sub-option: race scores may go below zero. */
  brutal: boolean;
  /** Seats to open when creating an online race (2-8). */
  onlinePlayers: number;
  sound: boolean;
  haptics: boolean;
  /** The cramp-risk gauge above the buttons. */
  showRisk: boolean;
}

const KEY = "flip-sprint:settings";

export const DEFAULT_SETTINGS: Settings = {
  mode: "solo",
  playerName: "",
  soloOpponents: 2,
  localPlayers: 3,
  localNames: [],
  difficulty: "normal",
  raceMode: "sprint",
  ruleset: "classique",
  brutal: false,
  onlinePlayers: 4,
  sound: true,
  haptics: true,
  showRisk: true,
};

export const loadSettings = (): Settings => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: Settings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable (private mode) — degrade gracefully */
  }
};

/** Fallback display name, so an empty field never shows as a blank. */
export const displayName = (name: string): string =>
  name.trim() || "Toi";

export const localName = (names: string[], seat: number): string =>
  names[seat]?.trim() || `Joueur ${seat + 1}`;
