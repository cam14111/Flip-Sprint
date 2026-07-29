// Cumulative local statistics. Purely for the player's own curiosity — nothing
// leaves the device.

const KEY = "flip-sprint:stats";

export interface Stats {
  games: number;
  wins: number;
  races: number;
  /** Sprints parfaits achieved. */
  perfects: number;
  cramps: number;
  /** Best score in a single race. */
  bestRace: number;
  /** Best winning total. */
  bestGame: number;
  currentStreak: number;
  bestStreak: number;
}

export const EMPTY_STATS: Stats = {
  games: 0,
  wins: 0,
  races: 0,
  perfects: 0,
  cramps: 0,
  bestRace: 0,
  bestGame: 0,
  currentStreak: 0,
  bestStreak: 0,
};

export const loadStats = (): Stats => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_STATS };
    return { ...EMPTY_STATS, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_STATS };
  }
};

export const saveStats = (stats: Stats): Stats => {
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
  return stats;
};

export const resetStats = (): Stats => saveStats({ ...EMPTY_STATS });

export interface RaceOutcome {
  score: number;
  perfect: boolean;
  cramped: boolean;
}

export const recordRace = (stats: Stats, outcome: RaceOutcome): Stats => ({
  ...stats,
  races: stats.races + 1,
  perfects: stats.perfects + (outcome.perfect ? 1 : 0),
  cramps: stats.cramps + (outcome.cramped ? 1 : 0),
  bestRace: Math.max(stats.bestRace, outcome.score),
});

export const recordGame = (
  stats: Stats,
  won: boolean,
  total: number
): Stats => {
  const currentStreak = won ? stats.currentStreak + 1 : 0;
  return {
    ...stats,
    games: stats.games + 1,
    wins: stats.wins + (won ? 1 : 0),
    bestGame: won ? Math.max(stats.bestGame, total) : stats.bestGame,
    currentStreak,
    bestStreak: Math.max(stats.bestStreak, currentStreak),
  };
};
