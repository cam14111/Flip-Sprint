import { Menu } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UI, cardName } from "@/game/copy";
import { canStay, legalCardPicks, legalTargets } from "@/game/engine";
import { drawOdds } from "@/game/odds";
import {
  BURST,
  Card as CardType,
  DRAFT,
  GameAction,
  GameState,
  isNumberCard,
  SECOND_WIND,
  STUMBLE,
  WHISTLE,
} from "@/game/types";
import { cn } from "@/lib/utils";
import { Card, EmptyCard } from "./Card";
import { Incoming } from "./Incoming";
import { Lane } from "./Lane";
import { RiskGauge } from "./RiskGauge";
import { CRAMP_ANIMATION_MS } from "./theme";
import { transitionKey } from "./transition";

/**
 * The line above the buttons that tells the player what is being asked.
 *
 * `myMove` decides the grammatical person: the second person is only ever
 * addressed to the runner whose lane is pinned at the bottom, and that lane no
 * longer moves with the turn.
 */
const prompt = (game: GameState, myMove: boolean): string => {
  const actor = game.players[game.actor];
  switch (game.phase) {
    case "draw":
      if (game.burstLeft > 0) {
        return UI.forcedDraw(game.ruleset, actor.name, game.burstLeft);
      }
      return myMove ? UI.openingDraw : UI.openingDrawOther(actor.name);
    case "decide":
      return `${actor.name}, accélérer ou souffler ?`;
    case "targeting": {
      if (!myMove) return UI.chooseTargetOther(actor.name);
      const code = game.pendingAssign?.card.code;
      if (code === WHISTLE) return UI.chooseTargetWhistle;
      if (code === BURST) return UI.chooseTargetBurst;
      if (code === SECOND_WIND) return UI.chooseTargetSecondWind;
      return UI.chooseTarget;
    }
    case "picking": {
      if (!myMove) return UI.chooseTargetOther(actor.name);
      const code = game.pendingAssign?.card.code;
      if (code === DRAFT) return UI.pickSteal;
      if (code === STUMBLE) return UI.pickStumble;
      return game.pendingAssign?.firstRef === undefined
        ? UI.pickRelayFirst
        : UI.pickRelaySecond;
    }
    default:
      return "";
  }
};

/**
 * True on a screen with room to spare in both directions — a tablet or a
 * desktop. The board is designed for a thumb, so the extra space goes into
 * bigger cards rather than into a different layout: the same board, read from
 * further away.
 */
const useRoomy = (): boolean => {
  const query = "(min-width: 680px) and (min-height: 700px)";
  const [roomy, setRoomy] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setRoomy(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return roomy;
};

/**
 * Watches the event log for a cramp so the lane can shake once.
 *
 * Keyed off the transition rather than the events array — online, the same
 * array arrives again with every snapshot, and the shake would restart on each
 * one instead of playing once. See `transition.ts`.
 */
const useCrampFlash = (game: GameState): number | null => {
  const [seat, setSeat] = useState<number | null>(null);
  const latest = useRef(game);
  latest.current = game;
  const transition = transitionKey(game);
  useEffect(() => {
    const cramp = latest.current.events.find((e) => e.type === "cramp");
    if (!cramp) return;
    setSeat(cramp.seat);
    const timer = setTimeout(() => setSeat(null), CRAMP_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [transition]);
  return seat;
};

/** Keeps the most recently revealed card on the table next to the deck. */
const useLastDrawn = (game: GameState): CardType | null => {
  const last = useRef<CardType | null>(null);
  const drew = game.events.find((e) => e.type === "drew");
  if (drew) {
    // The card has already moved into a lane or the discard by now; the id is
    // enough to render it, and reusing it keeps the React key stable.
    last.current = { id: `drawn-${game.round}-${drew.code}`, code: drew.code };
  }
  if (game.phase === "roundOver" || game.phase === "gameOver") {
    last.current = null;
  }
  return last.current;
};

/**
 * The little the board needs to know about who is actually connected. Kept as
 * a local shape rather than importing the online client's type, so the online
 * module never gets pulled into the offline bundle.
 */
export interface SeatPresence {
  seat: number;
  online: boolean;
  out: boolean;
}

export interface GameScreenProps {
  game: GameState;
  dispatch: (action: GameAction) => void;
  onOpenMenu: () => void;
  showRisk: boolean;
  /** Blocks input while an AI runner is thinking, or while it is not my turn. */
  busy?: boolean;
  /**
   * The seat this device belongs to — solo and online. Its lane is anchored at
   * the bottom of the screen and stays there whoever is playing: watching your
   * own cards jump into the rivals' strip the moment somebody else acts is
   * disorienting.
   *
   * Left undefined for local play, where every seat is a different person in
   * the room and there is no "mine": there, the runner about to act is the one
   * who should have their lane under their thumb.
   */
  mySeat?: number | null;
  /** Online only: who is connected. */
  presence?: readonly SeatPresence[];
  /** Online only: the runner everyone is waiting on, when it is not me. */
  waitingFor?: string | null;
}

export const GameScreen = ({
  game,
  dispatch,
  onOpenMenu,
  showRisk,
  busy,
  mySeat,
  presence,
  waitingFor,
}: GameScreenProps) => {
  const targets = useMemo(
    () => (game.phase === "targeting" ? legalTargets(game) : []),
    [game]
  );
  const targeting = targets.length > 0;
  const picking = game.phase === "picking";
  const picks = useMemo(
    () => (picking ? legalCardPicks(game) : []),
    [game, picking]
  );
  const pick = (ref: string) => dispatch({ type: "pick", ref });
  const crampSeat = useCrampFlash(game);
  const lastDrawn = useLastDrawn(game);
  const roomy = useRoomy();

  // The lane pinned to the bottom, and whether it is the one being played.
  const bottomSeat =
    mySeat !== null && mySeat !== undefined && game.players[mySeat]
      ? mySeat
      : game.actor;
  const bottomRunner = game.players[bottomSeat];
  const myMove = bottomSeat === game.actor;
  const actor = game.players[game.actor];
  const odds = drawOdds(game, game.actor);

  const rivals = game.players
    .map((runner, seat) => ({ runner, seat }))
    .filter(({ seat }) => seat !== bottomSeat);

  // Up to three rivals fit as full-width stacked lanes; beyond that they move
  // to a scrollable strip of narrow ones. Fewer rivals means bigger cards, so
  // the space freed up goes to something worth looking at.
  const stacked = rivals.length <= 3;
  const rivalSize = !stacked
    ? roomy
      ? "sm"
      : "xs"
    : rivals.length <= 2
      ? roomy
        ? "lg"
        : "md"
      : roomy
        ? "md"
        : "sm";
  const mySize = roomy ? "lg" : "md";
  const interactive = !busy && !actor.isAI;

  // Keyboard: space accelerates, S catches breath, 1-8 pick a target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!interactive) return;
      if (targeting) {
        const index = Number(e.key) - 1;
        if (targets.includes(index)) dispatch({ type: "assign", target: index });
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        dispatch({ type: "hit" });
      } else if (e.key.toLowerCase() === "s" && canStay(game)) {
        dispatch({ type: "stay" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, game, interactive, targeting, targets]);

  return (
    // The board is designed for a thumb. On a wide screen it is centred and
    // capped rather than stretched: a lane spanning 1400px would put the cards
    // and the score at opposite ends of the desk.
    <div
      className="app-bg mx-auto flex h-[100dvh] w-full max-w-2xl flex-col text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* ---- Header --------------------------------------------------- */}
      <header className="flex shrink-0 items-center gap-3 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-none">
            {UI.race(game.round)}
          </p>
          <p className="mt-0.5 text-[11px] leading-none text-white/45">
            {game.roundLimit
              ? `sur ${game.roundLimit}`
              : `${UI.finishLine} ${game.scoreLimit}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={onOpenMenu}
          aria-label={UI.menu}
        >
          <Menu size={18} />
        </Button>
      </header>

      {/* ---- Rivals -----------------------------------------------------
          Few rivals get a full-width lane each, stacked and readable. Past
          three, they move to a compact horizontal strip so the board never
          scrolls vertically away from the buttons. */}
      <div
        className={cn(
          "no-scrollbar flex min-h-0 flex-1 flex-col px-3 pb-1",
          roomy && "justify-center gap-2",
          stacked ? "overflow-y-auto" : "overflow-x-auto"
        )}
      >
        <div className={cn(stacked ? "space-y-1.5" : "flex gap-2")}>
          {rivals.map(({ runner, seat }) => (
            <Lane
              key={runner.id}
              runner={runner}
              size={rivalSize}
              // Now that my own lane is pinned below, this highlight is what
              // says whose turn it is up here.
              active={seat === game.actor}
              compact={!stacked}
              targetable={interactive && targets.includes(seat)}
              onTarget={() => dispatch({ type: "assign", target: seat })}
              cramping={crampSeat === seat}
              offline={presence?.[seat]?.online === false}
              pickable={interactive ? picks : []}
              onPick={pick}
              picking={picking}
              brutal={game.brutal}
              className={cn(!stacked && "w-40 shrink-0")}
            />
          ))}
        </div>
      </div>

      {/* ---- Table band: the deck and the card just turned over --------- */}
      <div className="flex shrink-0 items-center justify-center gap-4 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {game.deck.length > 0 ? (
            <Card code={0} faceUp={false} size={roomy ? "md" : "sm"} />
          ) : (
            <EmptyCard size={roomy ? "md" : "sm"} />
          )}
          <span className="text-[10px] leading-tight tabular-nums text-white/35">
            {game.deck.length}
            <br />
            cartes
          </span>
        </div>

        <div className="flex items-center gap-2">
          {lastDrawn ? (
            <Card
              key={lastDrawn.id}
              code={lastDrawn.code}
              size={roomy ? "md" : "sm"}
              dealDelay={0}
            />
          ) : (
            <EmptyCard size={roomy ? "md" : "sm"} />
          )}
          {/* A number card says its own name; only action and modifier cards
              gain anything from a caption. */}
          <span className="max-w-[86px] text-[10px] leading-tight text-white/35">
            {lastDrawn && !isNumberCard(lastDrawn.code)
              ? cardName(lastDrawn.code)
              : "dernière carte"}
          </span>
        </div>
      </div>

      {/* ---- My lane, always here --------------------------------------- */}
      <div className="shrink-0 px-3">
        <Lane
          runner={bottomRunner}
          size={mySize}
          active={myMove}
          isMe
          targetable={interactive && targets.includes(bottomSeat)}
          onTarget={() => dispatch({ type: "assign", target: bottomSeat })}
          cramping={crampSeat === bottomSeat}
          offline={presence?.[bottomSeat]?.online === false}
          pickable={interactive ? picks : []}
          onPick={pick}
          picking={picking}
          brutal={game.brutal}
        />
      </div>

      {/* ---- Prompt and controls ---------------------------------------- */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        <p
          className="mb-2 text-center text-sm font-medium text-white/75"
          aria-live="polite"
        >
          {prompt(game, myMove)}
          {game.pendingAssign?.deferred && (
            <span className="ml-1 text-white/40">
              ({UI.deferredHint(game.ruleset)})
            </span>
          )}
        </p>

        {showRisk && !targeting && (
          <RiskGauge
            odds={odds}
            protectedBySecondWind={actor.secondWind !== null}
            who={myMove ? undefined : actor.name}
            className="mb-3"
          />
        )}

        {waitingFor ? (
          <p
            data-testid="waiting-for"
            className="py-4 text-center text-sm text-white/50"
          >
            En attente de <span className="text-white/80">{waitingFor}</span>…
          </p>
        ) : targeting ? (
          <p className="py-2 text-center text-xs text-white/45">
            Touche un couloir pour choisir
          </p>
        ) : picking ? (
          <p className="py-2 text-center text-xs text-white/45">
            {UI.pickHint}
          </p>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="go"
              size="xl"
              className="flex-1"
              disabled={!interactive}
              onClick={() => dispatch({ type: "hit" })}
            >
              {UI.hit}
            </Button>
            <Button
              variant="hold"
              size="xl"
              className="flex-1"
              disabled={!interactive || !canStay(game)}
              onClick={() => dispatch({ type: "stay" })}
            >
              {UI.stay}
            </Button>
          </div>
        )}
      </div>

      {/* Announces a sifflet or a rafale landing on a human runner. Lives here
          rather than in Overlays because this board is the one screen every
          mode renders. */}
      <Incoming game={game} mySeat={mySeat} />
    </div>
  );
};
