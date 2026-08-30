// The visual language of the cards.
//
// Number cards are coloured by *risk*, not by value: the more copies of a
// number exist in the deck, the more likely a second one cramps you. So the
// palette runs cool -> warm as the number climbs, and the board reads at a
// glance as "cool is quiet, hot is a big score you may not get to keep".
//
// Everything is drawn in CSS. No image is ever loaded: the cards stay razor
// sharp at any size, weigh nothing offline, and animate freely.

import {
  BURST,
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
  RELAY,
  SECOND_WIND,
  SQUALL,
  STUMBLE,
  TURBO,
  WHISTLE,
} from "@/game/types";

export interface CardSkin {
  /** Gradient stops for the card face. */
  from: string;
  to: string;
  /** Ink colour on that face. */
  text: string;
  /** Halo used for selection rings and event flashes. */
  glow: string;
}

const CALM: CardSkin = {
  from: "#38bdf8",
  to: "#1d76b8",
  text: "#04222f",
  glow: "#7dd3fc",
};

const ZERO: CardSkin = {
  from: "#5b6bb5",
  to: "#3a4780",
  text: "#ffffff",
  glow: "#a5b4fc",
};

const WARM: CardSkin = {
  from: "#fbbf24",
  to: "#d97a0d",
  text: "#3a2405",
  glow: "#fde68a",
};

const HOT: CardSkin = {
  from: "#fb5b86",
  to: "#c9204f",
  text: "#ffffff",
  glow: "#fda4c0",
};

/** Coups bas only: the 13 is the most dangerous number ever printed. */
const BLAZING: CardSkin = {
  from: "#ff7a45",
  to: "#a4133c",
  text: "#ffffff",
  glow: "#ffb199",
};

export const numberSkin = (value: number): CardSkin => {
  if (value === 0) return ZERO;
  if (value <= 4) return CALM;
  if (value <= 8) return WARM;
  if (value <= 12) return HOT;
  return BLAZING;
};

// --- Coups bas: the three special numbers ----------------------------------
// Each one has to be unmistakable at a glance, because each one changes what
// the lane is worth — and two of them are ruinous.

/** A false start: the colour drains out of it. */
export const FAUX_DEPART_SKIN: CardSkin = {
  from: "#6b7280",
  to: "#374151",
  text: "#e5e7eb",
  glow: "#9ca3af",
};

/** Hitting the wall: slate, cracked through with red. */
export const LE_MUR_SKIN: CardSkin = {
  from: "#4b5563",
  to: "#1f2937",
  text: "#fecaca",
  glow: "#f87171",
};

/** The lucky bib: the only card on the table that glitters. */
export const FETICHE_SKIN: CardSkin = {
  from: "#fde68a",
  to: "#b45309",
  text: "#3a2405",
  glow: "#fef3c7",
};

/** Penalties are the exact mirror of the Bonus cards: same shape, rusted. */
export const PENALTY_SKIN: CardSkin = {
  from: "#fb7185",
  to: "#9f1239",
  text: "#ffffff",
  glow: "#fda4af",
};

/** And the Coup de barre is the negative of the Turbo. */
export const COUP_DE_BARRE_SKIN: CardSkin = {
  from: "#94a3b8",
  to: "#334155",
  text: "#f8fafc",
  glow: "#cbd5e1",
};

/** Modifiers get a chrome treatment so they never read as a number. */
export const TURBO_SKIN: CardSkin = {
  from: "#facc15",
  to: "#a16207",
  text: "#231400",
  glow: "#fde047",
};

export const BONUS_SKIN: CardSkin = {
  from: "#c4b5fd",
  to: "#7c5cd6",
  text: "#1b0f3d",
  glow: "#ddd6fe",
};

/** Action cards share a dark base and are told apart by their neon accent. */
export const ACTION_SKINS: Record<number, CardSkin> = {
  [WHISTLE]: {
    from: "#0e3f52",
    to: "#07222e",
    text: "#67e8f9",
    glow: "#22d3ee",
  },
  [BURST]: {
    from: "#4a1338",
    to: "#280a1e",
    text: "#f9a8d4",
    glow: "#f472b6",
  },
  [SECOND_WIND]: {
    from: "#0d3f31",
    to: "#06231b",
    text: "#6ee7b7",
    glow: "#34d399",
  },
  // Coups bas. La Bourrasque garde la teinte de la Rafale : même geste, un
  // cran au-dessus.
  [SQUALL]: {
    from: "#4a1338",
    to: "#280a1e",
    text: "#f9a8d4",
    glow: "#f472b6",
  },
  [LAST_STRAIGHT]: {
    from: "#4a3308",
    to: "#241802",
    text: "#fcd34d",
    glow: "#fbbf24",
  },
  [RELAY]: {
    from: "#2e1065",
    to: "#170833",
    text: "#c4b5fd",
    glow: "#a78bfa",
  },
  [DRAFT]: {
    from: "#0b3a45",
    to: "#041d24",
    text: "#5eead4",
    glow: "#2dd4bf",
  },
  [STUMBLE]: {
    from: "#3f2d17",
    to: "#1f160a",
    text: "#fdba74",
    glow: "#fb923c",
  },
};

export const cardSkin = (code: CardCode): CardSkin => {
  // The specials are number cards, so they must be claimed before the generic
  // branch reads their code as a value and paints Le Mur like a 41.
  if (code === FAUX_DEPART) return FAUX_DEPART_SKIN;
  if (code === LE_MUR) return LE_MUR_SKIN;
  if (code === DOSSARD_FETICHE) return FETICHE_SKIN;
  if (isNumberCard(code)) return numberSkin(code);
  if (code === TURBO) return TURBO_SKIN;
  if (isBonusCard(code)) return BONUS_SKIN;
  if (code === COUP_DE_BARRE) return COUP_DE_BARRE_SKIN;
  if (isPenaltyCard(code)) return PENALTY_SKIN;
  return ACTION_SKINS[code] ?? ZERO;
};

export const cardGradient = (code: CardCode): string => {
  const skin = cardSkin(code);
  return `linear-gradient(150deg, ${skin.from}, ${skin.to})`;
};

/** How long a cramping lane plays its collapse before the recap appears. */
export const CRAMP_ANIMATION_MS = 620;

/** Delay between the three cards of a Rafale, so the burst is readable. */
export const BURST_STAGGER_MS = 260;

/**
 * How long the announcement of a card played on you stays up before clearing
 * itself. Long enough to read two short lines, short enough that a player who
 * already understood is not kept waiting — and a tap dismisses it anyway.
 */
export const INCOMING_ALERT_MS = 2400;

/** Unscaled lane footprints per card size, for the ScaledBox wrappers. */
export const CARD_DIMS = {
  xs: { w: 30, h: 42 },
  sm: { w: 42, h: 58 },
  md: { w: 56, h: 78 },
  lg: { w: 70, h: 98 },
} as const;

export type CardSize = keyof typeof CARD_DIMS;

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: "Débutant",
  normal: "Confirmé",
  hard: "Expert",
};
