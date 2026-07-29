import { Button } from "@/components/ui/button";
import { UI } from "@/game/copy";
import { leaders } from "@/game/scoring";
import { GameState, PERFECT_BONUS } from "@/game/types";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { Confetti } from "./Confetti";

/** One row of the race recap: who scored what, and how. */
const RecapRow = ({
  name,
  lane,
  score,
  total,
  perfect,
  cramped,
  highlight,
}: {
  name: string;
  lane: number[];
  score: number;
  total: number;
  perfect: boolean;
  cramped: boolean;
  highlight: boolean;
}) => (
  <div
    className={cn(
      "rounded-xl px-3 py-2",
      highlight ? "bg-white/10 ring-1 ring-neon-cyan/40" : "bg-white/[0.04]"
    )}
  >
    <div className="flex items-baseline gap-2">
      <span className="truncate text-sm font-bold">{name}</span>
      {perfect && (
        <span className="rounded bg-amber-400/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-amber-300">
          Sprint parfait +{PERFECT_BONUS}
        </span>
      )}
      {cramped && (
        <span className="rounded bg-rose-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-rose-300">
          {UI.cramp}
        </span>
      )}
      <span className="ml-auto shrink-0 tabular-nums">
        <span
          className={cn(
            "text-base font-black",
            cramped ? "text-rose-300/70" : "text-white"
          )}
        >
          +{score}
        </span>
        <span className="ml-2 text-xs text-white/45">{total}</span>
      </span>
    </div>
    {lane.length > 0 && (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {lane.map((code, i) => (
          <Card key={`${code}-${i}`} code={code} size="xs" />
        ))}
      </div>
    )}
  </div>
);

const Sheet = ({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 px-3 pb-3 backdrop-blur-sm sm:items-center">
    <div
      className="animate-board-in w-full max-w-md rounded-3xl bg-[#180c3a] p-4 shadow-2xl ring-1 ring-white/10"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <h2 className="text-center text-2xl font-black italic tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-center text-sm text-white/60">{subtitle}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  </div>
);

export interface OverlaysProps {
  game: GameState;
  humanSeat: number | null;
  onNextRound: () => void;
  onNewGame: () => void;
  onHome: () => void;
}

export const Overlays = ({
  game,
  humanSeat,
  onNextRound,
  onNewGame,
  onHome,
}: OverlaysProps) => {
  if (game.phase !== "roundOver" && game.phase !== "gameOver") return null;

  const over = game.phase === "gameOver";
  const winner = over ? leaders(game.players)[0] : -1;
  const iWon = humanSeat !== null && winner === humanSeat;

  // Best race first, so the recap reads like a podium.
  const rows = game.players
    .map((runner, seat) => ({ runner, seat }))
    .filter(({ runner }) => !runner.out)
    .sort((a, b) => b.runner.totalScore - a.runner.totalScore);

  const tied = !over && leaders(game.players).length > 1;

  return (
    <>
      {over && iWon && <Confetti />}
      <Sheet
        title={over ? UI.gameOver : UI.raceOver}
        subtitle={
          over
            ? UI.winner(game.players[winner]?.name ?? "")
            : tied
              ? UI.tieBreak
              : UI.race(game.round)
        }
      >
        <div className="no-scrollbar max-h-[46vh] space-y-1.5 overflow-y-auto">
          {rows.map(({ runner, seat }) => (
            <RecapRow
              key={runner.id}
              name={runner.name}
              lane={runner.lastLane}
              score={runner.lastRoundScore}
              total={runner.totalScore}
              perfect={runner.perfect}
              cramped={runner.status === "cramped"}
              highlight={seat === humanSeat || (over && seat === winner)}
            />
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          {over ? (
            <>
              <Button variant="ghost" size="lg" className="flex-1" onClick={onHome}>
                {UI.home}
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={onNewGame}
              >
                {UI.newGame}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={onNextRound}
            >
              {UI.nextRace}
            </Button>
          )}
        </div>
      </Sheet>
    </>
  );
};
