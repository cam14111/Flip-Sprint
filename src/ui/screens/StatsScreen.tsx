import { Button } from "@/components/ui/button";
import { Stats } from "@/game/stats";

const Tile = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-xl bg-white/[0.04] px-3 py-3 text-center">
    <p className="text-2xl font-black tabular-nums text-white">{value}</p>
    <p className="mt-0.5 text-[11px] leading-tight text-white/45">{label}</p>
  </div>
);

export const StatsScreen = ({
  stats,
  onReset,
}: {
  stats: Stats;
  onReset: () => void;
}) => {
  const winRate =
    stats.games === 0 ? 0 : Math.round((stats.wins / stats.games) * 100);

  return (
    <div className="mx-auto max-w-md">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Parties" value={stats.games} />
        <Tile label="Victoires" value={stats.wins} />
        <Tile label="Réussite" value={`${winRate} %`} />
        <Tile label="Courses" value={stats.races} />
        <Tile label="Sprints parfaits" value={stats.perfects} />
        <Tile label="Crampes" value={stats.cramps} />
        <Tile label="Meilleure course" value={stats.bestRace} />
        <Tile label="Meilleur total" value={stats.bestGame} />
        <Tile label="Série en cours" value={stats.currentStreak} />
      </div>

      <p className="mt-3 text-center text-[11px] text-white/40">
        Meilleure série : {stats.bestStreak}
      </p>

      <Button
        variant="outline"
        size="md"
        className="mt-6 w-full"
        onClick={onReset}
      >
        Remettre les compteurs à zéro
      </Button>
    </div>
  );
};
