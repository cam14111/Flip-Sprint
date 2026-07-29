import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  UserX,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UI } from "@/game/copy";
import { displayName, RACE_MODES, Settings } from "@/game/settings";
import type { OnlineErrorCode, OnlinePlayerMeta } from "@/online/client";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/online/protocol";
import { loadOnlineSession } from "@/online/session";
import { useOnlineGame } from "@/hooks/useOnlineGame";
import { cn } from "@/lib/utils";
import { GameScreen } from "./GameScreen";
import { Overlays } from "./Overlays";

const ERROR_TEXT: Record<OnlineErrorCode, string> = {
  "not-found": "Aucune partie ne porte ce code.",
  full: "Cette partie est complète.",
  started: "Cette partie a déjà commencé.",
  expired: "Cette partie est trop ancienne.",
  network: "Connexion impossible. Vérifie ton réseau et réessaie.",
  unconfigured:
    "Le mode en ligne n'est pas encore configuré sur cette installation.",
  corrupted:
    "La partie est incohérente : un appareil ne suit plus les règles. Mieux vaut en relancer une.",
};

const Shell = ({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack?: () => void;
  children: React.ReactNode;
}) => (
  <div
    className="app-bg flex min-h-[100dvh] flex-col px-5 py-6 text-white"
    style={{
      paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)",
    }}
  >
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-5 flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={UI.back}>
            <ArrowLeft size={18} />
          </Button>
        )}
        <h1 className="text-2xl font-black italic tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  </div>
);

/** One row of the lobby: who is seated, and whether they are actually there. */
const SeatRow = ({
  player,
  index,
  onExclude,
}: {
  player: OnlinePlayerMeta | null;
  index: number;
  onExclude?: () => void;
}) => (
  <div
    data-testid="seat-row"
    data-filled={player ? "yes" : "no"}
    className={cn(
      "flex items-center gap-2 rounded-xl px-3 py-2.5",
      player ? "bg-white/[0.06]" : "border border-dashed border-white/10"
    )}
  >
    <span className="w-5 text-center text-xs font-bold text-white/35">
      {index + 1}
    </span>
    {player ? (
      <>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            player.online ? "bg-emerald-400" : "bg-white/25"
          )}
          aria-label={player.online ? "connecté" : "absent"}
        />
        <span className="truncate text-sm font-semibold">
          {player.name}
          {player.isMe && <span className="ml-1 text-neon-cyan">(toi)</span>}
        </span>
        {player.out && (
          <span className="ml-auto text-[10px] uppercase text-white/35">parti</span>
        )}
        {onExclude && (
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={onExclude}
          >
            <UserX size={14} />
            Exclure
          </Button>
        )}
      </>
    ) : (
      <span className="text-sm italic text-white/25">en attente…</span>
    )}
  </div>
);

export type OnlineIntent =
  | { type: "menu" }
  | { type: "join"; code: string }
  | { type: "resume" };

export interface OnlineModeProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  intent: OnlineIntent;
  onExit: () => void;
}

export const OnlineMode = ({
  settings,
  onChange,
  intent,
  onExit,
}: OnlineModeProps) => {
  const online = useOnlineGame();
  const { stage, snap } = online;
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);
  const me = displayName(settings.playerName);

  // Act on the intent that brought us here — an invite link, or a race this
  // device was already part of. Guarded by a ref rather than by the dependency
  // list: joining is a network round-trip that claims a seat, and StrictMode
  // double-invokes effects, so "runs once" has to mean once.
  const acted = useRef(false);
  useEffect(() => {
    if (acted.current) return;
    acted.current = true;
    if (intent.type === "join") {
      setCodeInput(intent.code);
      void online.join(intent.code, me);
    } else if (intent.type === "resume") {
      const session = loadOnlineSession();
      if (session) void online.resume(session);
    }
    // Only ever fires for the intent this screen was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareUrl = useMemo(() => {
    if (!snap) return "";
    const url = new URL(window.location.href);
    url.searchParams.set("join", snap.code);
    return url.toString();
  }, [snap]);

  const share = async () => {
    if (!snap) return;
    const text = `Rejoins ma course Flip Sprint — code ${snap.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Flip Sprint", text, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the user dismissed the share sheet */
    }
  };

  // --- Connecting / errors -------------------------------------------------

  if (stage.kind === "connecting") {
    return (
      <Shell title="En ligne">
        <div className="flex flex-col items-center gap-3 py-16 text-white/60">
          <Loader2 className="animate-spin" size={28} />
          <p className="text-sm">{stage.label}</p>
        </div>
      </Shell>
    );
  }

  if (stage.kind === "error") {
    return (
      <Shell title="En ligne" onBack={onExit}>
        <div className="rounded-2xl bg-rose-500/10 p-4 ring-1 ring-rose-400/30">
          <AlertTriangle className="mb-2 text-rose-300" size={20} />
          <p className="text-sm text-white/85">{ERROR_TEXT[stage.error]}</p>
        </div>
        <Button
          variant="ghost"
          size="lg"
          className="mt-4 w-full"
          onClick={online.backToMenu}
        >
          Réessayer
        </Button>
      </Shell>
    );
  }

  // --- Setup ---------------------------------------------------------------

  if (stage.kind === "menu" || !snap) {
    const spec = RACE_MODES[settings.raceMode];
    return (
      <Shell title="Jouer en ligne" onBack={onExit}>
        <div className="space-y-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/50">
              Places à ouvrir
            </label>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    data-testid={`seats-${n}`}
                    aria-pressed={settings.onlinePlayers === n}
                    onClick={() => onChange({ onlinePlayers: n })}
                    className={cn(
                      "rounded-xl py-2 text-sm font-semibold transition-colors",
                      settings.onlinePlayers === n
                        ? "bg-neon-cyan text-[#04222f]"
                        : "bg-white/5 text-white/70 ring-1 ring-white/10"
                    )}
                  >
                    {n}
                  </button>
                )
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-white/40">
              {spec.label} — {spec.detail}
            </p>
          </div>

          <Button
            variant="go"
            size="lg"
            className="w-full"
            onClick={() =>
              online.create(me, spec.scoreLimit, spec.roundLimit, settings.onlinePlayers)
            }
          >
            Créer une partie
          </Button>
        </div>

        <div className="mt-4 space-y-2 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <label className="mb-1.5 block text-xs font-medium text-white/50">
            Rejoindre avec un code
          </label>
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="A1B2C3"
            maxLength={7}
            autoCapitalize="characters"
            autoCorrect="off"
            className="h-12 w-full rounded-xl border border-white/15 bg-white/10 px-3 text-center text-xl font-black tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-white/25 focus:border-neon-cyan focus:outline-none"
          />
          <Button
            variant="ghost"
            size="lg"
            className="w-full"
            disabled={codeInput.replace(/[^A-Z0-9]/g, "").length < 6}
            onClick={() => online.join(codeInput, me)}
          >
            Rejoindre
          </Button>
        </div>
      </Shell>
    );
  }

  // --- Lobby ---------------------------------------------------------------

  if (snap.status === "lobby") {
    return (
      <Shell title="Salon" onBack={online.cancelLobby}>
        <div className="rounded-2xl bg-white/5 p-4 text-center ring-1 ring-white/10">
          <p className="text-xs uppercase tracking-widest text-white/40">
            Code de la partie
          </p>
          <p
            data-testid="game-code"
            className="my-2 text-4xl font-black tracking-[0.25em] text-neon-cyan"
          >
            {snap.code}
          </p>
          <Button variant="ghost" size="md" className="w-full" onClick={share}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Lien copié" : "Partager l'invitation"}
          </Button>
        </div>

        <div className="mt-4 space-y-1.5">
          {Array.from({ length: snap.maxPlayers }, (_, i) => (
            <SeatRow key={i} index={i} player={snap.players[i] ?? null} />
          ))}
        </div>

        <p className="mt-4 text-center text-[12px] text-white/40">
          La course démarre dès que tout le monde est là.
        </p>

        {snap.canStartEarly && (
          <Button
            variant="go"
            size="lg"
            className="mt-3 w-full"
            onClick={online.startEarly}
          >
            Commencer maintenant
          </Button>
        )}
      </Shell>
    );
  }

  // --- The race ------------------------------------------------------------

  if (!snap.game) {
    return (
      <Shell title="En ligne">
        <div className="flex flex-col items-center gap-3 py-16 text-white/60">
          <Loader2 className="animate-spin" size={28} />
          <p className="text-sm">Synchronisation…</p>
        </div>
      </Shell>
    );
  }

  if (snap.corrupted) {
    return (
      <Shell title="En ligne" onBack={online.finish}>
        <div className="rounded-2xl bg-rose-500/10 p-4 ring-1 ring-rose-400/30">
          <AlertTriangle className="mb-2 text-rose-300" size={20} />
          <p className="text-sm text-white/85">{ERROR_TEXT.corrupted}</p>
        </div>
      </Shell>
    );
  }

  const away = snap.players.filter((p) => p.canExclude);

  return (
    <>
      <GameScreen
        game={snap.game}
        dispatch={online.dispatch}
        onOpenMenu={online.detach}
        showRisk={settings.showRisk}
        busy={!snap.myTurn}
        presence={snap.players}
        waitingFor={
          snap.myTurn ? null : snap.players[snap.game.actor]?.name ?? null
        }
      />

      {!snap.connected && (
        <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-center gap-2 bg-amber-500/90 py-1.5 text-xs font-semibold text-amber-950">
          <WifiOff size={14} />
          Reconnexion…
        </div>
      )}

      {away.length > 0 && (
        <div className="fixed inset-x-3 bottom-24 z-30 rounded-xl bg-[#2a1450]/95 p-3 ring-1 ring-white/15">
          <p className="mb-2 text-xs text-white/70">
            {away[0].name} ne répond plus depuis une minute et bloque la table.
          </p>
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={() => online.excludePlayer(away[0].seat)}
          >
            <UserX size={14} />
            Continuer sans {away[0].name}
          </Button>
        </div>
      )}

      <Overlays
        game={snap.game}
        humanSeat={snap.mySeat}
        onNextRound={online.setNextReady}
        onNewGame={() => void online.requestRematch(me)}
        onHome={() => {
          void online.finish();
          onExit();
        }}
        waitingForOthers={
          snap.myNextReady &&
          snap.players.some((p) => !p.out && !p.ready && !p.isMe)
        }
      />
    </>
  );
};
