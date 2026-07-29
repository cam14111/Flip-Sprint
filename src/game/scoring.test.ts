import { describe, expect, it } from "vitest";
import { laneScore, leaders, runningSeats } from "./scoring";
import {
  BONUS_10,
  BONUS_2,
  Card,
  CardCode,
  RunnerState,
  TURBO,
} from "./types";

const runner = (
  codes: CardCode[],
  extra: Partial<RunnerState> = {}
): RunnerState => ({
  id: "seat0",
  name: "A",
  isAI: false,
  lane: codes.map((code, i): Card => ({ id: `c${i}`, code })),
  secondWind: null,
  status: "running",
  perfect: false,
  opened: true,
  totalScore: 0,
  lastRoundScore: 0,
  roundScores: [],
  lastLane: [],
  ...extra,
});

describe("le score d'un couloir", () => {
  it("additionne les numéros", () => {
    expect(laneScore(runner([3, 7, 12]))).toBe(22);
  });

  it("ignore la valeur des cartes action et compte les bonus une fois", () => {
    expect(laneScore(runner([5, BONUS_2, BONUS_10]))).toBe(5 + 2 + 10);
  });

  it("double les numéros seulement, avant d'ajouter les bonus", () => {
    // (3 + 7) x 2 + 10 = 30 — et non (3 + 7 + 10) x 2 = 40
    expect(laneScore(runner([3, 7, TURBO, BONUS_10]))).toBe(30);
  });

  it("ajoute les 15 points du sprint parfait sans les doubler", () => {
    // (1+2+3+4+5+6+7) x 2 = 56, + 15
    const lane = [1, 2, 3, 4, 5, 6, 7, TURBO];
    expect(laneScore(runner(lane, { perfect: true }))).toBe(71);
  });

  it("est nul en cas de crampe, modificateurs compris", () => {
    const cramped = runner([9, TURBO, BONUS_10], { status: "cramped" });
    expect(laneScore(cramped)).toBe(0);
  });

  it("conserve les points d'un coureur sifflé", () => {
    expect(laneScore(runner([8, 4], { status: "whistled" }))).toBe(12);
  });

  it("compte zéro pour un couloir vide", () => {
    expect(laneScore(runner([]))).toBe(0);
    expect(laneScore(runner([0]))).toBe(0);
  });
});

describe("le classement", () => {
  const withTotals = (totals: number[], out: boolean[] = []): RunnerState[] =>
    totals.map((totalScore, i) =>
      runner([], { totalScore, out: out[i], id: `seat${i}` })
    );

  it("désigne un meneur unique", () => {
    expect(leaders(withTotals([10, 40, 25]))).toEqual([1]);
  });

  it("signale une égalité en tête", () => {
    expect(leaders(withTotals([40, 40, 25]))).toEqual([0, 1]);
  });

  it("ignore les coureurs qui ont quitté la partie", () => {
    expect(leaders(withTotals([90, 40], [true, false]))).toEqual([1]);
  });

  it("ne retient comme actifs que les coureurs encore en course", () => {
    const players: RunnerState[] = [
      runner([], { status: "running" }),
      runner([], { status: "banked" }),
      runner([], { status: "cramped" }),
      runner([], { status: "running", out: true }),
    ];
    expect(runningSeats(players)).toEqual([0]);
  });
});
