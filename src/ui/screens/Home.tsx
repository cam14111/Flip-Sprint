import { BookOpen, ChartBar, Check, Play, Settings2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, TAGLINE, UI } from "@/game/copy";
import {
  localName,
  RACE_MODE_ORDER,
  RACE_MODES,
  Settings,
} from "@/game/settings";
import { Difficulty, GameMode } from "@/game/types";
import { cn } from "@/lib/utils";
import { Card } from "../Card";
import { DIFFICULTY_LABEL } from "../theme";

const MODES: { value: GameMode; label: string; hint: string }[] = [
  { value: "solo", label: "Solo", hint: "Contre l'ordinateur, même hors-ligne" },
  { value: "local", label: "À plusieurs", hint: "Tout le monde sur cet appareil" },
  { value: "online", label: "En ligne", hint: "Chacun sur son téléphone" },
];

const Chip = ({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
      active
        ? "bg-neon-cyan text-[#04222f]"
        : "bg-white/5 text-white/70 ring-1 ring-white/10 hover:bg-white/10",
      className
    )}
  >
    {children}
  </button>
);

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <label className="mb-1.5 block text-xs font-medium text-white/50">
      {label}
    </label>
    {children}
  </div>
);

/** A small fan of cards, echoing the app icon. */
const Hero = () => (
  <div className="pointer-events-none relative mx-auto mb-4 flex h-[86px] w-40 items-center justify-center">
    {[
      { code: 3, rotate: -18, x: -36 },
      { code: 11, rotate: 18, x: 36 },
      { code: 7, rotate: 0, x: 0 },
    ].map(({ code, rotate, x }, i) => (
      <div
        key={code}
        className="animate-sprint-in absolute"
        style={{
          transform: `translateX(${x}px) rotate(${rotate}deg)`,
          animationDelay: `${i * 110}ms`,
        }}
      >
        <Card code={code} size="md" />
      </div>
    ))}
  </div>
);

export interface HomeProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  hasSavedGame: boolean;
  onPlay: () => void;
  onResume: () => void;
  onOpen: (panel: "rules" | "stats" | "settings") => void;
}

export const Home = ({
  settings,
  onChange,
  hasSavedGame,
  onPlay,
  onResume,
  onOpen,
}: HomeProps) => (
  <div
    className="app-bg flex min-h-[100dvh] flex-col items-center px-5 py-6 text-white"
    style={{
      paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
    }}
  >
    <div className="w-full max-w-sm">
      <Hero />
      <h1 className="text-center text-4xl font-black italic tracking-tight">
        {APP_NAME.split(" ")[0]}{" "}
        <span className="text-neon-cyan">{APP_NAME.split(" ")[1]}</span>
      </h1>
      <p className="mt-1.5 text-center text-sm text-white/55">{TAGLINE}</p>

      <div className="mt-6 space-y-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
        <Field label="Comment joues-tu ?">
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map((mode) => (
              <Chip
                key={mode.value}
                active={settings.mode === mode.value}
                onClick={() => onChange({ mode: mode.value })}
                className="px-1 text-[13px]"
              >
                {mode.label}
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-white/40">
            {MODES.find((m) => m.value === settings.mode)?.hint}
          </p>
        </Field>

        <Field label="Ton nom">
          <input
            value={settings.playerName}
            onChange={(e) => onChange({ playerName: e.target.value })}
            placeholder="Toi"
            maxLength={14}
            className="h-11 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-base text-white placeholder:text-white/35 focus:border-neon-cyan focus:outline-none"
          />
        </Field>

        {settings.mode === "solo" && (
          <>
            <Field label="Adversaires">
              <div className="grid grid-cols-6 gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <Chip
                    key={n}
                    active={settings.soloOpponents === n}
                    onClick={() => onChange({ soloOpponents: n })}
                  >
                    {n}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Niveau">
              <div className="grid grid-cols-3 gap-1.5">
                {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                  <Chip
                    key={d}
                    active={settings.difficulty === d}
                    onClick={() => onChange({ difficulty: d })}
                  >
                    {DIFFICULTY_LABEL[d]}
                  </Chip>
                ))}
              </div>
            </Field>
          </>
        )}

        {settings.mode === "local" && (
          <>
            <Field label="Nombre de joueurs">
              <div className="grid grid-cols-7 gap-1.5">
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <Chip
                    key={n}
                    active={settings.localPlayers === n}
                    onClick={() => onChange({ localPlayers: n })}
                  >
                    {n}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Noms">
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: settings.localPlayers }, (_, seat) => (
                  <input
                    key={seat}
                    value={settings.localNames[seat] ?? ""}
                    onChange={(e) => {
                      const names = settings.localNames.slice();
                      names[seat] = e.target.value;
                      onChange({ localNames: names });
                    }}
                    placeholder={localName([], seat)}
                    maxLength={12}
                    className="h-9 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white placeholder:text-white/30 focus:border-neon-cyan focus:outline-none"
                  />
                ))}
              </div>
            </Field>
          </>
        )}

        {settings.mode === "online" && (
          <Field label="Places à ouvrir">
            <div className="grid grid-cols-7 gap-1.5">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <Chip
                  key={n}
                  active={settings.onlinePlayers === n}
                  onClick={() => onChange({ onlinePlayers: n })}
                >
                  {n}
                </Chip>
              ))}
            </div>
          </Field>
        )}

        <Field label="Règles">
          <div className="grid grid-cols-2 gap-1.5">
            <Chip
              active={settings.ruleset === "classique"}
              onClick={() => onChange({ ruleset: "classique" })}
            >
              {UI.rulesetClassique}
            </Chip>
            <Chip
              active={settings.ruleset === "coupsbas"}
              onClick={() => onChange({ ruleset: "coupsbas" })}
            >
              {UI.rulesetCoupsBas}
            </Chip>
          </div>
          {settings.ruleset === "coupsbas" && (
            <>
              <p className="mt-1.5 text-[11px] text-white/40">
                {UI.coupsBasHint}
              </p>
              <button
                type="button"
                onClick={() => onChange({ brutal: !settings.brutal })}
                aria-pressed={settings.brutal}
                className={cn(
                  "mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ring-1 transition-colors",
                  settings.brutal
                    ? "bg-rose-500/15 ring-rose-400/50"
                    : "bg-white/5 ring-white/10"
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded border",
                    settings.brutal
                      ? "border-rose-300 bg-rose-400 text-rose-950"
                      : "border-white/30"
                  )}
                  aria-hidden
                >
                  {settings.brutal && (
                    <Check size={11} strokeWidth={4} />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold leading-none">
                    {UI.brutalLabel}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-white/45">
                    {UI.brutalHint}
                  </span>
                </span>
              </button>
            </>
          )}
        </Field>

        <Field label="Format">
          <div className="grid grid-cols-3 gap-1.5">
            {RACE_MODE_ORDER.map((mode) => (
              <Chip
                key={mode}
                active={settings.raceMode === mode}
                onClick={() => onChange({ raceMode: mode })}
                className="flex flex-col items-center gap-0.5 py-2"
              >
                <span>{RACE_MODES[mode].label}</span>
              </Chip>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-white/40">
            {RACE_MODES[settings.raceMode].detail}
          </p>
        </Field>
      </div>

      <div className="mt-5 space-y-2">
        {hasSavedGame && (
          <Button variant="ghost" size="lg" className="w-full" onClick={onResume}>
            {UI.resume}
          </Button>
        )}
        <Button
          variant={settings.mode === "online" ? "ghost" : "go"}
          size="xl"
          className="w-full"
          onClick={onPlay}
        >
          {settings.mode === "online" ? <Wifi size={20} /> : <Play size={20} />}
          {UI.play}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <IconTile icon={<BookOpen size={18} />} label={UI.rules} onClick={() => onOpen("rules")} />
        <IconTile icon={<ChartBar size={18} />} label={UI.stats} onClick={() => onOpen("stats")} />
        <IconTile icon={<Settings2 size={18} />} label={UI.settings} onClick={() => onOpen("settings")} />
      </div>
    </div>
  </div>
);

const IconTile = ({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex flex-col items-center gap-1 rounded-xl bg-white/5 py-3 text-xs font-medium text-white/80 ring-1 ring-white/10 transition-colors hover:bg-white/10"
  >
    {icon}
    {label}
  </button>
);
