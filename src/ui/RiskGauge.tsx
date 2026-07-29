import { UI } from "@/game/copy";
import { DrawOdds } from "@/game/odds";
import { cn } from "@/lib/utils";

/**
 * The signature read of Flip Sprint: how likely the next card is to cramp you.
 *
 * Every card is face up in this game, so this number is not a hint or a
 * heuristic — it is the exact probability, and the AI reasons from the same
 * figure. Showing it turns "do I dare?" into a decision the player can feel.
 */
export const RiskGauge = ({
  odds,
  protectedBySecondWind,
  className,
}: {
  odds: DrawOdds;
  protectedBySecondWind: boolean;
  className?: string;
}) => {
  const percent = odds.cramp * 100;
  // The bar tops out at 60%: past that the choice is obvious anyway, and a
  // full-width bar reads more clearly than a technically proportional one.
  const width = Math.min(100, (percent / 60) * 100);

  const tone =
    percent === 0
      ? "from-emerald-400 to-emerald-500"
      : percent < 15
        ? "from-cyan-400 to-sky-500"
        : percent < 32
          ? "from-amber-400 to-orange-500"
          : "from-rose-400 to-rose-600";

  return (
    <div className={cn("select-none", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
          {UI.riskLabel}
        </span>
        <span
          className={cn(
            "text-sm font-black tabular-nums",
            percent === 0
              ? "text-emerald-300"
              : percent < 32
                ? "text-white"
                : "text-rose-300"
          )}
          aria-live="polite"
        >
          {UI.riskValue(percent)}
        </span>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={UI.riskLabel}
      >
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-[width] duration-500",
            tone
          )}
          style={{ width: `${width}%` }}
        />
      </div>

      {protectedBySecondWind && (
        <p className="mt-1 text-[11px] text-emerald-300/90">
          {UI.riskProtected}
        </p>
      )}
    </div>
  );
};
