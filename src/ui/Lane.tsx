import { STATUS_LABEL } from "@/game/copy";
import { laneScore, numberCount } from "@/game/scoring";
import { PERFECT_COUNT, RunnerState } from "@/game/types";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { CardSize } from "./theme";

/**
 * How full the seven-number track is, 0..1 — drives the speed lines behind a
 * lane so pushing your luck is visible before you read a single number.
 */
const pressure = (runner: RunnerState): number =>
  Math.min(1, numberCount(runner) / PERFECT_COUNT);

const STATUS_STYLE: Record<string, string> = {
  running: "ring-white/12",
  banked: "ring-amber-300/40",
  whistled: "ring-cyan-300/45",
  cramped: "ring-rose-500/45",
};

export interface LaneProps {
  runner: RunnerState;
  size?: CardSize;
  /** This runner must act right now. */
  active?: boolean;
  /** The lane belongs to the person holding the device. */
  isMe?: boolean;
  /** Legal target of the action card being handed out. */
  targetable?: boolean;
  onTarget?: () => void;
  /** Plays the cramp shake once. */
  cramping?: boolean;
  /** Online: this runner's device is not currently connected. */
  offline?: boolean;
  compact?: boolean;
  className?: string;
}

export const Lane = ({
  runner,
  size = "md",
  active,
  isMe,
  targetable,
  onTarget,
  cramping,
  offline,
  compact,
  className,
}: LaneProps) => {
  const score = laneScore(runner);
  const numbers = numberCount(runner);

  return (
    <div
      className={cn(
        "speed-lines relative overflow-hidden rounded-2xl bg-white/[0.04] p-2 ring-1 transition-shadow",
        STATUS_STYLE[runner.status],
        active && "bg-white/[0.09] ring-2 ring-neon-cyan/70",
        targetable && "animate-pulse-ring cursor-pointer ring-neon-magenta/70",
        cramping && "animate-cramp",
        runner.status === "cramped" && "opacity-60",
        runner.out && "opacity-35",
        className
      )}
      style={{ "--speed": pressure(runner) * 0.85 } as React.CSSProperties}
      onClick={targetable ? onTarget : undefined}
      role={targetable ? "button" : undefined}
      tabIndex={targetable ? 0 : undefined}
      aria-label={
        targetable ? `Choisir ${runner.name}` : `Couloir de ${runner.name}`
      }
      onKeyDown={
        targetable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTarget?.();
              }
            }
          : undefined
      }
    >
      {/* Name, status, running total */}
      <div className="relative mb-1.5 flex items-baseline gap-2 px-0.5">
        <span
          className={cn(
            "truncate font-bold leading-none",
            compact ? "text-[11px]" : "text-sm",
            isMe ? "text-neon-cyan" : "text-white/85"
          )}
        >
          {runner.name}
        </span>

        {offline && (
          <span
            title="Déconnecté"
            aria-label="Déconnecté"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
          />
        )}

        {/* A Second souffle is deliberately shown as a badge and never as a
            card in the lane: it scores nothing and counts toward nothing, so
            sitting it among the lane's cards would misread. */}
        {runner.secondWind && (
          <span
            title="Second souffle"
            aria-label="Second souffle en main"
            className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-black leading-none text-emerald-300 ring-1 ring-emerald-400/40"
          >
            2e SOUFFLE
          </span>
        )}

        <span className="ml-auto flex items-baseline gap-1.5">
          {runner.status !== "running" && (
            <span
              className={cn(
                "text-[9px] font-bold uppercase tracking-wide",
                runner.status === "cramped"
                  ? "text-rose-300"
                  : "text-white/45"
              )}
            >
              {STATUS_LABEL[runner.status]}
            </span>
          )}
          <span
            className={cn(
              "font-black tabular-nums leading-none",
              compact ? "text-sm" : "text-lg",
              runner.status === "cramped" ? "text-rose-300/70" : "text-white"
            )}
          >
            {score}
          </span>
        </span>
      </div>

      {/* The lane itself */}
      <div className="relative flex min-h-[1px] flex-wrap gap-1">
        {runner.lane.length === 0 ? (
          <span className="py-2 text-[11px] italic text-white/25">
            {runner.status === "cramped" ? "Couloir vidé" : "Couloir vide"}
          </span>
        ) : (
          runner.lane.map((card, i) => (
            <Card
              key={card.id}
              code={card.code}
              size={size}
              dealDelay={i === runner.lane.length - 1 ? 0 : undefined}
            />
          ))
        )}
      </div>

      {/* Seven-notch progress toward a Sprint parfait */}
      {!compact && (
        <div className="relative mt-1.5 flex gap-1" aria-hidden>
          {Array.from({ length: PERFECT_COUNT }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < numbers ? "bg-neon-cyan/80" : "bg-white/10"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};
