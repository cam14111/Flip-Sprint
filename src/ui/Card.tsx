import { memo } from "react";
import { cardName } from "@/game/copy";
import {
  BURST,
  bonusValue,
  CardCode,
  COUP_DE_BARRE,
  DOSSARD_FETICHE,
  DRAFT,
  FAUX_DEPART,
  isBonusCard,
  isNumberCard,
  isPenaltyCard,
  LAST_STRAIGHT,
  LE_MUR,
  numberValue,
  penaltyValue,
  RELAY,
  SQUALL,
  STUMBLE,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "@/game/types";
import { cn } from "@/lib/utils";
import { cardGradient, cardSkin, CARD_DIMS, CardSize } from "./theme";

// Original glyphs, drawn inline so nothing is ever fetched and every card stays
// crisp at any scale.

const WhistleGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 10h3.5L11 6v12l-4.5-4H3z" strokeLinejoin="round" />
    <path d="M15 9.5a3.5 3.5 0 0 1 0 5" strokeLinecap="round" />
    <path d="M18 6.8a7.5 7.5 0 0 1 0 10.4" strokeLinecap="round" />
  </svg>
);

const BurstGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6l5 6-5 6" />
    <path d="M10 6l5 6-5 6" />
    <path d="M17 6l5 6-5 6" />
  </svg>
);

const SecondWindGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M2 8h10a3 3 0 1 0-3-3.2" />
    <path d="M2 12.5h13.5a3.2 3.2 0 1 1-3.2 3.4" />
    <path d="M2 17h7" />
  </svg>
);

/** Four chevrons where the Rafale has three: the same gust, harder. */
const SquallGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 6l4 3-4 3" />
    <path d="M8 6l4 3-4 3" />
    <path d="M14 6l4 3-4 3" />
    <path d="M6 17h13" />
  </svg>
);

/** A finish line, and a bar coming down after it. */
const LastStraightGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M5 3v18" />
    <path d="M9 5h10v6H9z" />
    <path d="M9 8h10" />
    <path d="M14 5v6" />
    <path d="M8 17h11" />
  </svg>
);

/** Two batons crossing: one card each way. */
const RelayGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 8h13l-3-3" />
    <path d="M21 16H8l3 3" />
  </svg>
);

/** Slipstream: a card pulled out of the runner ahead. */
const DraftGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 5h6" />
    <path d="M3 10h9" />
    <path d="M3 15h6" />
    <path d="M14 12h7l-3-3" />
    <path d="M21 12l-3 3" />
  </svg>
);

/** A card slipping out of somebody's hands. */
const StumbleGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 3h9v8H6z" />
    <path d="M12 14l4 5" />
    <path d="M16 14l-4 5" />
  </svg>
);

const GLYPHS: Record<number, () => JSX.Element> = {
  [WHISTLE]: WhistleGlyph,
  [BURST]: BurstGlyph,
  [SECOND_WIND]: SecondWindGlyph,
  [SQUALL]: SquallGlyph,
  [LAST_STRAIGHT]: LastStraightGlyph,
  [RELAY]: RelayGlyph,
  [DRAFT]: DraftGlyph,
  [STUMBLE]: StumbleGlyph,
};

/** Short label under an action card's glyph — dropped on the smallest sizes. */
const ACTION_LABEL: Record<number, string> = {
  [WHISTLE]: "SIFFLET",
  [BURST]: "RAFALE",
  [SECOND_WIND]: "SOUFFLE",
  [SQUALL]: "BOURRASQUE",
  [LAST_STRAIGHT]: "DERNIÈRE",
  [RELAY]: "RELAIS",
  [DRAFT]: "ASPIRATION",
  [STUMBLE]: "FAUX PAS",
};

/**
 * The text a face shows: "7", "+10", "×2", "−6", "÷2".
 *
 * The three Coups bas specials print the number they actually score as — a
 * player must be able to read Le Mur as a 7 to see the duplicate coming.
 * What sets them apart is their colour and the word underneath.
 */
const faceLabel = (code: CardCode): string => {
  const value = numberValue(code);
  if (value !== null) return String(value);
  if (isBonusCard(code)) return `+${bonusValue(code)}`;
  if (code === TURBO) return "×2";
  if (code === COUP_DE_BARRE) return "÷2";
  if (isPenaltyCard(code)) return `−${penaltyValue(code)}`;
  return String(code);
};

/** The word under a special number or a penalty, so it cannot be mistaken. */
const SPECIAL_LABEL: Record<number, string> = {
  [FAUX_DEPART]: "FAUX DÉPART",
  [LE_MUR]: "LE MUR",
  [DOSSARD_FETICHE]: "FÉTICHE",
  [COUP_DE_BARRE]: "COUP DE BARRE",
};

const CornerMarks = ({ label }: { label: string }) => (
  <>
    <span className="absolute left-1 top-0.5 text-[9px] font-bold leading-none opacity-80">
      {label}
    </span>
    <span className="absolute bottom-0.5 right-1 rotate-180 text-[9px] font-bold leading-none opacity-80">
      {label}
    </span>
  </>
);

const Face = ({ code, size }: { code: CardCode; size: CardSize }) => {
  const skin = cardSkin(code);
  const Glyph = GLYPHS[code];
  const tiny = size === "xs" || size === "sm";
  const dims = CARD_DIMS[size];

  // Type is sized from the card itself rather than from fixed classes, so the
  // four sizes stay visually identical — and "+10" shrinks enough to fit where
  // "7" does not need to.
  const label = faceLabel(code);
  const shrink = label.length >= 3 ? 0.68 : label.length === 2 ? 0.84 : 1;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[0.6em] shadow-lg backface-hidden rotate-y-180"
      style={{ background: cardGradient(code), color: skin.text }}
    >
      {/* Inner hairline and top-left sheen: gives the flat gradient some depth
          without a single image. */}
      <div className="absolute inset-[2px] rounded-[0.5em] ring-1 ring-white/25" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 28% 18%, rgba(255,255,255,0.6), transparent 46%)",
        }}
      />

      {Glyph ? (
        <div className="relative flex flex-col items-center gap-[0.15em]">
          <span
            className="block"
            style={{ width: dims.h * 0.3, height: dims.h * 0.3 }}
          >
            <Glyph />
          </span>
          {!tiny && (
            <span
              className="whitespace-nowrap font-black leading-none tracking-wide opacity-90"
              style={{ fontSize: dims.h * 0.105 }}
            >
              {ACTION_LABEL[code]}
            </span>
          )}
        </div>
      ) : (
        <>
          {isNumberCard(code) && !tiny && <CornerMarks label={label} />}
          <div className="relative flex flex-col items-center leading-none">
            <span
              className="font-black italic tabular-nums drop-shadow-sm"
              style={{ fontSize: dims.h * 0.42 * shrink }}
            >
              {label}
            </span>
            {/* A special number prints the value it scores as — you have to be
                able to see the duplicate coming — so the word underneath is
                what tells it apart from its plain twin. */}
            {SPECIAL_LABEL[code] && !tiny && (
              <span
                className="mt-[0.12em] whitespace-nowrap font-black uppercase tracking-wide opacity-90"
                style={{ fontSize: dims.h * 0.092 }}
              >
                {SPECIAL_LABEL[code]}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
};

/** The deck's back: speed lines on the night-track violet. */
const Back = () => (
  <div
    className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-[0.6em] shadow-lg backface-hidden"
    style={{ background: "linear-gradient(150deg, #3b1d7a, #21114a)" }}
  >
    <div className="absolute inset-[2px] rounded-[0.5em] ring-1 ring-white/20" />
    <div
      className="absolute inset-0 opacity-70"
      style={{
        backgroundImage:
          "repeating-linear-gradient(105deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 9px)",
      }}
    />
    <span className="relative h-[42%] w-[3px] rounded-full bg-gradient-to-b from-neon-cyan to-neon-magenta" />
  </div>
);

export interface CardProps {
  code: CardCode;
  size?: CardSize;
  /** False renders the back — used for the deck pile and the deal animation. */
  faceUp?: boolean;
  onClick?: () => void;
  /** Highlight as a legal choice. */
  selectable?: boolean;
  disabled?: boolean;
  /** Staggered entrance delay (ms). */
  dealDelay?: number;
  className?: string;
}

export const Card = memo(
  ({
    code,
    size = "md",
    faceUp = true,
    onClick,
    selectable,
    disabled,
    dealDelay,
    className,
  }: CardProps) => {
    const dims = CARD_DIMS[size];
    const interactive = !!onClick && !disabled;

    return (
      <div
        className={cn(
          "perspective relative select-none",
          interactive ? "cursor-pointer" : "cursor-default",
          dealDelay !== undefined && "animate-sprint-in",
          className
        )}
        style={{
          width: dims.w,
          height: dims.h,
          fontSize: dims.h * 0.14,
          animationDelay: dealDelay !== undefined ? `${dealDelay}ms` : undefined,
        }}
        onClick={interactive ? onClick : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={faceUp ? `Carte ${cardName(code)}` : "Carte face cachée"}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
        <div
          className={cn(
            "flip-transition preserve-3d absolute inset-0 transition-transform duration-500",
            faceUp && "rotate-y-180",
            selectable && "animate-pulse-ring rounded-[0.6em]"
          )}
        >
          <Back />
          <Face code={code} size={size} />
        </div>
      </div>
    );
  }
);

Card.displayName = "Card";

/** An empty slot outline, used for the deck once it is exhausted. */
export const EmptyCard = ({ size = "md" }: { size?: CardSize }) => {
  const dims = CARD_DIMS[size];
  return (
    <div
      className="rounded-[0.6em] border-2 border-dashed border-white/15 bg-white/[0.03]"
      style={{ width: dims.w, height: dims.h }}
    />
  );
};
