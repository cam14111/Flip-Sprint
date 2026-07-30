// The visual language of the cards.
//
// Number cards are coloured by *risk*, not by value: the more copies of a
// number exist in the deck, the more likely a second one cramps you. So the
// palette runs cool -> warm as the number climbs, and the board reads at a
// glance as "cool is quiet, hot is a big score you may not get to keep".
//
// Everything is drawn in CSS. No image is ever loaded: the cards stay razor
// sharp at any size, weigh nothing offline, and animate freely.

import { isBonusCard, isNumberCard, BURST, CardCode, SECOND_WIND, TURBO, WHISTLE } from "@/game/types";

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

export const numberSkin = (value: number): CardSkin => {
  if (value === 0) return ZERO;
  if (value <= 4) return CALM;
  if (value <= 8) return WARM;
  return HOT;
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
};

export const cardSkin = (code: CardCode): CardSkin => {
  if (isNumberCard(code)) return numberSkin(code);
  if (code === TURBO) return TURBO_SKIN;
  if (isBonusCard(code)) return BONUS_SKIN;
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
