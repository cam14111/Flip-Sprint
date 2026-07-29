import { memo } from "react";
import { cardName } from "@/game/copy";
import {
  BURST,
  bonusValue,
  CardCode,
  isBonusCard,
  isNumberCard,
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

const GLYPHS: Record<number, () => JSX.Element> = {
  [WHISTLE]: WhistleGlyph,
  [BURST]: BurstGlyph,
  [SECOND_WIND]: SecondWindGlyph,
};

/** Short label under an action card's glyph — dropped on the smallest sizes. */
const ACTION_LABEL: Record<number, string> = {
  [WHISTLE]: "SIFFLET",
  [BURST]: "RAFALE",
  [SECOND_WIND]: "SOUFFLE",
};

/** The text a face shows: "7", "+10", "×2". */
const faceLabel = (code: CardCode): string =>
  isBonusCard(code) ? `+${bonusValue(code)}` : code === TURBO ? "×2" : String(code);

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
          <span
            className="relative font-black italic leading-none tabular-nums drop-shadow-sm"
            style={{ fontSize: dims.h * 0.42 * shrink }}
          >
            {label}
          </span>
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
