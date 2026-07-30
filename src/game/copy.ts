// Every player-facing string in one place.
//
// Two reasons. It keeps the game's voice consistent — Flip Sprint speaks in
// running metaphors and never in card-game jargon — and it means adding a
// second language later is a translation job rather than a refactor.

import {
  BURST,
  bonusValue,
  CardCode,
  isBonusCard,
  isNumberCard,
  RunnerStatus,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "./types";

export const APP_NAME = "Flip Sprint";
export const TAGLINE = "Pousse ta chance jusqu'à la ligne d'arrivée.";

/** Short name of a card, for badges and recaps. */
export const cardName = (code: CardCode): string => {
  if (isNumberCard(code)) return String(code);
  if (isBonusCard(code)) return `+${bonusValue(code)}`;
  if (code === TURBO) return "×2";
  if (code === WHISTLE) return "Coup de sifflet";
  if (code === BURST) return "Rafale";
  if (code === SECOND_WIND) return "Second souffle";
  return "?";
};

/** One-line explanation, used on the card back of the rules screen. */
export const cardHelp = (code: CardCode): string => {
  if (isNumberCard(code)) {
    return "Un numéro que tu n'as pas encore : il s'ajoute à ton couloir.";
  }
  if (isBonusCard(code)) {
    return `${bonusValue(code)} points ajoutés à la fin, après le turbo.`;
  }
  switch (code) {
    case TURBO:
      return "Double la somme de tes numéros. Les bonus s'ajoutent après.";
    case WHISTLE:
      return "Le coureur visé encaisse ses points et quitte la course.";
    case BURST:
      return "Le coureur visé doit prendre trois cartes d'affilée.";
    case SECOND_WIND:
      return "Annule un doublon. Une seule en main à la fois.";
    default:
      return "";
  }
};

export const STATUS_LABEL: Record<RunnerStatus, string> = {
  running: "En course",
  banked: "A soufflé",
  whistled: "Sifflé",
  cramped: "Crampe",
};

export const UI = {
  // --- Actions ------------------------------------------------------------
  hit: "Accélérer",
  stay: "Souffler",
  hitHint: "Prendre une carte de plus",
  stayHint: "Encaisser et sortir de la course",
  openingDraw: "Prends ta carte de départ",
  // Your own lane stays at the bottom of the screen whoever is playing, so the
  // prompt is the line that says whose move it is: it has to switch out of the
  // second person as soon as the runner acting is not you.
  openingDrawOther: (name: string) => `${name} prend sa carte de départ`,

  // --- Targeting ----------------------------------------------------------
  chooseTarget: "Choisis un coureur",
  chooseTargetWhistle: "Qui siffles-tu ?",
  chooseTargetBurst: "Qui prend la rafale ?",
  chooseTargetSecondWind: "À qui donnes-tu ce second souffle ?",
  chooseTargetOther: (name: string) => `${name} choisit une cible`,
  deferredHint: "Mise de côté pendant la rafale",

  // --- A card played on a human runner --------------------------------------
  // A sifflet or a rafale changes what you have to do next, and it arrives on
  // somebody else's turn — easy to miss entirely on a small screen. Hence an
  // announcement, phrased to the target when this device has one.
  incomingOnMe: (by: string) => `${by} te l'envoie`,
  incomingOnOther: (by: string, target: string) =>
    `${by} l'envoie sur ${target}`,
  whistleOnMe: "Tu encaisses tes points et tu sors de la course.",
  burstOnMe: "Tu dois prendre trois cartes d'affilée.",
  incomingDismiss: "Touche pour continuer",
  targetSelf: "Toi",

  // --- Race events --------------------------------------------------------
  cramp: "Crampe !",
  crampDetail: (value: number) => `Un deuxième ${value} : la course s'arrête là.`,
  perfect: "Sprint parfait !",
  perfectDetail: "Sept numéros différents. +15 et tout le monde s'arrête.",
  secondWindUsed: "Second souffle !",
  secondWindUsedDetail: (value: number) =>
    `Le deuxième ${value} est annulé, la course continue.`,
  whistled: (name: string) => `${name} se fait siffler`,
  burstOn: (name: string) => `Rafale sur ${name}`,
  banked: (name: string, score: number) => `${name} souffle avec ${score} pts`,
  reshuffle: "La défausse est remélangée",

  // --- Risk gauge ---------------------------------------------------------
  riskLabel: "Risque de crampe",
  riskValue: (percent: number) => `${Math.round(percent)} %`,
  riskSafe: "Aucun risque",
  riskProtected: "Protégé par ton second souffle",

  // --- Race / game --------------------------------------------------------
  race: (n: number) => `Course ${n}`,
  finishLine: "Ligne d'arrivée",
  raceOver: "Fin de course",
  gameOver: "Arrivée !",
  winner: (name: string) => `${name} l'emporte`,
  tieBreak: "Égalité en tête : on rejoue une course",
  nextRace: "Course suivante",
  totalScore: "Total",
  thisRace: "Cette course",

  // --- Screens ------------------------------------------------------------
  play: "Jouer",
  resume: "Reprendre la course",
  rules: "Comment jouer",
  settings: "Réglages",
  stats: "Statistiques",
  menu: "Menu",
  back: "Retour",
  quit: "Quitter",
  newGame: "Nouvelle partie",
  home: "Accueil",
} as const;
