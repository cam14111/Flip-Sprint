// Every player-facing string in one place.
//
// Two reasons. It keeps the game's voice consistent — Flip Sprint speaks in
// running metaphors and never in card-game jargon — and it means adding a
// second language later is a translation job rather than a refactor.

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
  penaltyValue,
  RELAY,
  RunnerStatus,
  SECOND_WIND,
  SQUALL,
  STUMBLE,
  TURBO,
  WHISTLE,
} from "./types";

export const APP_NAME = "Flip Sprint";
export const TAGLINE = "Pousse ta chance jusqu'à la ligne d'arrivée.";

/** Short name of a card, for badges and recaps. */
export const cardName = (code: CardCode): string => {
  // The three Coups bas specials ARE number cards, so they have to be named
  // before the generic branch claims them and calls Le Mur "41".
  if (code === FAUX_DEPART) return "Faux départ";
  if (code === LE_MUR) return "Le Mur";
  if (code === DOSSARD_FETICHE) return "Dossard fétiche";
  if (isNumberCard(code)) return String(code);
  if (isBonusCard(code)) return `+${bonusValue(code)}`;
  if (code === TURBO) return "×2";
  if (code === WHISTLE) return "Coup de sifflet";
  if (code === BURST) return "Rafale";
  if (code === SECOND_WIND) return "Second souffle";
  if (code === COUP_DE_BARRE) return "Coup de barre";
  if (isPenaltyCard(code)) return `−${penaltyValue(code)}`;
  if (code === LAST_STRAIGHT) return "Dernière ligne droite";
  if (code === SQUALL) return "Bourrasque";
  if (code === RELAY) return "Relais";
  if (code === DRAFT) return "Aspiration";
  if (code === STUMBLE) return "Faux pas";
  return "?";
};

/** One-line explanation, used on the card back of the rules screen. */
export const cardHelp = (code: CardCode): string => {
  // Same ordering trap as `cardName`: the specials are number cards too.
  if (code !== FAUX_DEPART && code !== LE_MUR && code !== DOSSARD_FETICHE) {
    if (isNumberCard(code)) {
      return "Un numéro que tu n'as pas encore : il s'ajoute à ton couloir.";
    }
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
    case FAUX_DEPART:
      return "Score nul pour la course, et interdiction de souffler — sauf Sprint parfait.";
    case LE_MUR:
      return "Vide le couloir de celui qui le reçoit. Il ne reste que lui.";
    case DOSSARD_FETICHE:
      return "Autorise un second 13. Les deux comptent vers le Sprint parfait.";
    case COUP_DE_BARRE:
      return "Divise la somme des numéros par deux, avant les pénalités.";
    case LAST_STRAIGHT:
      return "Le coureur visé prend une carte, puis doit souffler.";
    case SQUALL:
      return "Le coureur visé prend quatre cartes d'affilée.";
    case RELAY:
      return "Échange deux cartes entre deux couloirs.";
    case DRAFT:
      return "Prends une carte dans le couloir d'un rival.";
    case STUMBLE:
      return "Le coureur visé perd une carte de ton choix.";
    default:
      if (isPenaltyCard(code)) {
        return `${penaltyValue(code)} points retirés, après le Coup de barre.`;
      }
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
  deferredHint: (ruleset: string) =>
    ruleset === "coupsbas"
      ? "Mise de côté pendant la bourrasque"
      : "Mise de côté pendant la rafale",

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

  // --- Coups bas ------------------------------------------------------------
  rulesetClassique: "Classique",
  rulesetCoupsBas: "Coups bas",
  coupsBasHint: "Tout est permis dans le peloton",
  brutalLabel: "Nuit noire",
  brutalHint: "Les scores peuvent passer sous zéro",
  pickSteal: "Quelle carte lui prends-tu ?",
  pickStumble: "Quelle carte lui fais-tu lâcher ?",
  pickRelayFirst: "Première carte à échanger",
  pickRelaySecond: "Contre laquelle ?",
  pickHint: "Touche une carte",
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
  /** The forced-draw prompt names the card that caused it. */
  forcedDraw: (ruleset: string, name: string, left: number) =>
    `${ruleset === "coupsbas" ? "Bourrasque" : "Rafale"} sur ${name} — ${left} carte${left > 1 ? "s" : ""} à prendre`,
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
