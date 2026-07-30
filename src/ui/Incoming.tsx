import { useCallback, useEffect, useRef, useState } from "react";
import { cardHelp, cardName, UI } from "@/game/copy";
import {
  BURST,
  CardCode,
  GameEvent,
  GameState,
  WHISTLE,
} from "@/game/types";
import { Card } from "./Card";
import { cardSkin, INCOMING_ALERT_MS } from "./theme";
import { transitionKey } from "./transition";

/** The two cards that are played *on* a runner rather than into a lane. */
type Struck = Extract<GameEvent, { type: "whistled" | "burstStart" }>;

interface Incoming {
  code: CardCode;
  /** Who played it, and who takes it. */
  by: string;
  target: string;
  /** The target is the person holding this device, so we can say "tu". */
  onMe: boolean;
}

/**
 * Watches the event log for a Coup de sifflet or a Rafale landing on a human
 * runner, and holds it just long enough to be read.
 *
 * Keyed off the transition, never off the events array itself — see
 * `transition.ts`: online, an identical array arrives with every snapshot, and
 * an announcement re-armed that often would never dismiss. Everything else is
 * read through a ref rather than added to the dependencies, for the same
 * reason: an unrelated re-render must not restart the timer.
 */
const useIncoming = (game: GameState, mySeat?: number | null) => {
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const latest = useRef({ game, mySeat });
  latest.current = { game, mySeat };
  const transition = transitionKey(game);

  useEffect(() => {
    const { game: g, mySeat: seat } = latest.current;
    const owned = seat !== null && seat !== undefined;
    // Solo and online: this device has exactly one runner. Local play has no
    // "mine" — every seat is a person in the room, so every seat counts.
    const mine = (s: number) => (owned ? s === seat : !g.players[s]?.isAI);

    const hit = g.events.find(
      (e): e is Struck =>
        (e.type === "whistled" || e.type === "burstStart") &&
        // Targeting yourself is legal, and needs no announcement: you just
        // chose it.
        e.by !== e.seat &&
        mine(e.seat)
    );
    if (!hit) return;

    setIncoming({
      code: hit.type === "whistled" ? WHISTLE : BURST,
      by: g.players[hit.by]?.name ?? "",
      target: g.players[hit.seat]?.name ?? "",
      onMe: owned,
    });
    const timer = setTimeout(() => setIncoming(null), INCOMING_ALERT_MS);
    return () => clearTimeout(timer);
  }, [transition]);

  return [incoming, useCallback(() => setIncoming(null), [])] as const;
};

/**
 * The announcement itself: the card, who sent it, and what it does to you.
 *
 * It covers the board on purpose. A sifflet or a rafale lands during someone
 * else's turn and silently changes what you must do next; a line of prompt
 * text was too easy to scroll past. A tap anywhere dismisses it.
 */
export const Incoming = ({
  game,
  mySeat,
}: {
  game: GameState;
  mySeat?: number | null;
}) => {
  const [incoming, dismiss] = useIncoming(game, mySeat);

  // The recap sheet is the better story once the race is over — never stack
  // the two.
  if (!incoming || game.phase === "roundOver" || game.phase === "gameOver") {
    return null;
  }

  const skin = cardSkin(incoming.code);
  const title = `${cardName(incoming.code)} !`;
  const effect = incoming.onMe
    ? incoming.code === WHISTLE
      ? UI.whistleOnMe
      : UI.burstOnMe
    : cardHelp(incoming.code);

  return (
    <div
      data-testid="incoming-alert"
      role="alertdialog"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-6 backdrop-blur-[2px]"
      onClick={dismiss}
    >
      <div
        className="animate-board-in flex w-full max-w-xs flex-col items-center gap-3 rounded-3xl bg-[#180c3a] p-5 text-center"
        style={{
          boxShadow: `0 0 0 1px ${skin.glow}55, 0 24px 70px -12px ${skin.glow}55`,
        }}
      >
        <Card code={incoming.code} size="lg" dealDelay={0} />

        <h2
          className="text-2xl font-black italic tracking-tight"
          style={{ color: skin.text }}
        >
          {title}
        </h2>

        <p className="text-sm text-white/60">
          {incoming.onMe
            ? UI.incomingOnMe(incoming.by)
            : UI.incomingOnOther(incoming.by, incoming.target)}
        </p>

        <p className="text-sm font-medium leading-snug text-white/90">
          {effect}
        </p>

        <p className="text-[11px] uppercase tracking-wide text-white/30">
          {UI.incomingDismiss}
        </p>
      </div>
    </div>
  );
};
