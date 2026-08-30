// The online client: one instance per joined race (2 to 8 runners).
//
// Responsibilities:
//   • create / join / resume a race (anonymous auth, seat claiming)
//   • run the lobby: seats fill, the race auto-starts when full, or the host
//     starts early with whoever is seated (`start` pins how many take part)
//   • mirror the public tree and project it through the pure engine into a
//     regular GameState (replay.ts)
//   • turn UI actions into protocol writes, with the peek→read→write dance
//     that discloses one secret card under database-rule control
//   • keep the protocol moving by reacting to STATE, not to callbacks: dealing
//     the next course, recording the result and converting a leave intent are
//     all detected from the replayed state and re-executed idempotently. That
//     is precisely what makes a refresh or a reconnection safe at any moment.
//   • presence (onDisconnect), so everyone can see who is actually there
//
// Departures never stall the table: a voluntary leaver posts a `leave` intent
// that the current actor converts into a rules-checked `forfeit` in the log; an
// absent player can be excluded by the others once the rules agree they have
// been gone 60 seconds.

import {
  Database,
  DataSnapshot,
  get,
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { GameAction, GameState, RulesetId } from "@/game/types";
import { activeCount, activeSeats, leaders } from "@/game/scoring";
import { generateDeal } from "./dealer";
import { ensureSignedIn } from "./firebase";
import {
  actionKey,
  CLAIM_AFTER_MS,
  courseKey,
  courseNumber,
  deckRef,
  fromWireAction,
  GAME_EXPIRY_MS,
  GameResult,
  isValidGameCode,
  LobbyInfo,
  MAX_PLAYERS,
  MIN_PLAYERS,
  normalizeGameCode,
  OnlineAction,
  PublicState,
  randomGameCode,
  Seat,
  SeatInfo,
  StartInfo,
  toWireAction,
  wireSeat,
  WireAction,
} from "./protocol";
import { CourseInput, replayGame, ReplayConfig, ReplayResult } from "./replay";
import { clearOnlineSession, saveOnlineSession } from "./session";

export type OnlineErrorCode =
  | "not-found"
  | "full"
  | "started"
  | "expired"
  | "network"
  | "unconfigured"
  | "corrupted";

export class OnlineError extends Error {
  code: OnlineErrorCode;
  constructor(code: OnlineErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface OnlinePlayerMeta {
  seat: Seat;
  name: string;
  isMe: boolean;
  online: boolean;
  lastSeen: number | null;
  /** Left the game (forfeit applied, or a leave intent posted). */
  out: boolean;
  /** Tapped "next race" on the end-of-race panel. */
  ready: boolean;
  /** Holding the table up while away — the others may exclude them. */
  canExclude: boolean;
}

export interface OnlineSnapshot {
  status: "lobby" | "playing" | "over";
  code: string;
  mySeat: Seat;
  /** Seats the host opened. */
  maxPlayers: number;
  /** The rules the host chose. Every device plays what the lobby says. */
  ruleset: RulesetId;
  brutal: boolean;
  /** Seats actually playing (0 while the lobby is still filling). */
  playerCount: number;
  isHost: boolean;
  started: boolean;
  /** The host may start now with whoever is seated. */
  canStartEarly: boolean;
  players: OnlinePlayerMeta[];
  scoreLimit: number;
  roundLimit: number | null;
  /** Projected engine state; null until the race has started. */
  game: GameState | null;
  /** The log failed engine validation — a peer client is misbehaving. */
  corrupted: boolean;
  /** It is my move (I am the engine's actor, Rafale included). */
  myTurn: boolean;
  /** My own realtime link. */
  connected: boolean;
  result: GameResult | null;
  myNextReady: boolean;
  rematchCode: string | null;
  /** Last action appended after attaching — drives remote-move sounds. */
  lastAction: (OnlineAction & { key: string }) | null;
  /** A write is in flight (locks the UI against double taps). */
  busy: boolean;
}

type Unsub = () => void;
type Flags = Record<string, boolean | undefined>;

const P = {
  game: (c: string) => `games/${c}`,
  lobby: (c: string) => `games/${c}/lobby`,
  seats: (c: string) => `games/${c}/seats`,
  seat: (c: string, s: Seat) => `games/${c}/seats/${s}`,
  start: (c: string) => `games/${c}/start`,
  state: (c: string) => `games/${c}/state`,
  presence: (c: string, s: Seat) => `games/${c}/presence/${s}`,
  leave: (c: string, s: Seat) => `games/${c}/leave/${s}`,
  forfeit: (c: string, s: Seat) => `games/${c}/forfeits/${s}`,
  result: (c: string) => `games/${c}/result`,
  nextReady: (c: string) => `games/${c}/nextReady`,
  ready: (c: string, s: Seat) => `games/${c}/nextReady/${s}`,
  rematch: (c: string) => `games/${c}/rematch`,
  courses: (c: string) => `games/${c}/courses`,
  deal: (c: string, k: string) => `games/${c}/courses/${k}/deal`,
  action: (c: string, k: string, a: string) =>
    `games/${c}/courses/${k}/actions/${a}`,
  peek: (c: string, k: string, s: Seat) => `games/${c}/courses/${k}/peek/${s}`,
  secrets: (c: string) => `secrets/${c}`,
  secretCourse: (c: string, k: string) => `secrets/${c}/${k}`,
  secretCard: (c: string, k: string, cardRef: string) =>
    `secrets/${c}/${k}/${cardRef}`,
};

interface CourseModel {
  dealt: boolean;
  actions: Map<string, OnlineAction>;
}

export class OnlineGame {
  readonly code: string;
  readonly mySeat: Seat;
  private db: Database;

  private lobby: LobbyInfo | null = null;
  private seats: Record<string, SeatInfo | undefined> = {};
  private start: StartInfo | null = null;
  private presence: Record<
    string,
    { online?: boolean; lastSeen?: number } | undefined
  > = {};
  private result: GameResult | null = null;
  private readyFlags: Flags = {};
  private leaveFlags: Flags = {};
  private forfeitFlags: Flags = {};
  private rematchCode: string | null = null;
  private courses = new Map<string, CourseModel>();
  private publicState: PublicState | null = null;
  private connected = false;

  private replay: ReplayResult | null = null;
  private snapshot: OnlineSnapshot;
  private listeners = new Set<() => void>();
  private unsubs: Unsub[] = [];
  private destroyed = false;
  private busy = false;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** False during the first sync — actions ingested then are not "live". */
  private live = false;
  private lastAction: (OnlineAction & { key: string }) | null = null;
  private lastActionKey: string | null = null;

  private constructor(db: Database, _uid: string, code: string, seat: Seat) {
    this.db = db;
    this.code = code;
    this.mySeat = seat;
    this.snapshot = this.buildSnapshot();
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  static async create(
    name: string,
    scoreLimit: number,
    roundLimit: number | null,
    maxPlayers: number,
    ruleset: RulesetId = "classique",
    brutal = false
  ): Promise<OnlineGame> {
    const players = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, maxPlayers));
    const { uid, db } = await ensureSignedIn();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomGameCode();
      const deal = generateDeal(ruleset);
      const payload: Record<string, unknown> = {
        [P.game(code)]: {
          lobby: {
            hostName: name,
            scoreLimit,
            roundLimit,
            maxPlayers: players,
            // Frozen for the whole game: the deck differs, so it can never
            // change once a card has been dealt.
            ruleset,
            brutal: ruleset === "coupsbas" && brutal,
            createdAt: serverTimestamp(),
          },
          seats: { 0: { uid, name } },
          state: {
            course: courseKey(1),
            next: actionKey(0),
            actor: "0",
            phase: "draw",
            cursorRef: deckRef(0),
            nextCourse: courseKey(2),
          },
          courses: { [courseKey(1)]: { deal: { at: serverTimestamp() } } },
        },
        [P.secretCourse(code, courseKey(1))]: deal.secrets,
      };

      try {
        await update(ref(db), payload);
        saveOnlineSession({ code, seat: 0, name });
        const game = new OnlineGame(db, uid, code, 0);
        await game.attach();
        return game;
      } catch (error) {
        lastError = error; // code collision or transient failure — try again
      }
    }
    throw new OnlineError("network", String(lastError));
  }

  static async join(rawCode: string, name: string): Promise<OnlineGame> {
    const code = normalizeGameCode(rawCode);
    if (!isValidGameCode(code)) throw new OnlineError("not-found");
    const { uid, db } = await ensureSignedIn();

    const lobbySnap = await get(ref(db, P.lobby(code))).catch(() => {
      throw new OnlineError("network");
    });
    if (!lobbySnap.exists()) throw new OnlineError("not-found");
    const lobby = lobbySnap.val() as LobbyInfo;
    const maxPlayers = lobby.maxPlayers ?? MIN_PLAYERS;

    // Claim the lowest free seat; on a race, re-read and try the next one.
    for (let attempt = 0; attempt < MAX_PLAYERS; attempt++) {
      const seatsSnap = await get(ref(db, P.seats(code)));
      const seats = (seatsSnap.val() ?? {}) as Record<string, SeatInfo | undefined>;

      // Already seated (own invite link, reinstall, second tab): re-attach.
      for (let s = 0; s < maxPlayers; s++) {
        if (seats[String(s)]?.uid === uid) {
          saveOnlineSession({ code, seat: s, name });
          const game = new OnlineGame(db, uid, code, s);
          await game.attach();
          return game;
        }
      }

      if ((await get(ref(db, P.start(code)))).exists()) {
        throw new OnlineError("started");
      }

      let free = -1;
      for (let s = 1; s < maxPlayers; s++) {
        if (!seats[String(s)]) {
          free = s;
          break;
        }
      }
      if (free === -1) throw new OnlineError("full");

      const createdAt = typeof lobby.createdAt === "number" ? lobby.createdAt : 0;
      if (createdAt && Date.now() - createdAt > GAME_EXPIRY_MS) {
        throw new OnlineError("expired");
      }

      try {
        await set(ref(db, P.seat(code, free)), { uid, name });
        saveOnlineSession({ code, seat: free, name });
        const game = new OnlineGame(db, uid, code, free);
        await game.attach();
        return game;
      } catch {
        // Someone claimed that seat (or the race just started) between our
        // read and our write — look again.
      }
    }
    throw new OnlineError("full");
  }

  static async resume(code: string): Promise<OnlineGame> {
    const { uid, db } = await ensureSignedIn();
    const seatsSnap = await get(ref(db, P.seats(code))).catch(() => {
      throw new OnlineError("network");
    });
    if (!seatsSnap.exists()) throw new OnlineError("not-found");
    const seats = seatsSnap.val() as Record<string, SeatInfo | undefined>;

    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (seats[String(s)]?.uid === uid) {
        const game = new OnlineGame(db, uid, code, s);
        await game.attach();
        return game;
      }
    }
    throw new OnlineError("not-found");
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private async attach(): Promise<void> {
    const code = this.code;

    // One listener on the whole game subtree. The payload is small (a race is
    // a few hundred short records) and a single subscription removes every
    // ordering question between separate child listeners.
    const gameRef = ref(this.db, P.game(code));
    const unsubGame = onValue(gameRef, (snap: DataSnapshot) => {
      this.ingest(snap.val() as Record<string, unknown> | null);
      this.live = true;
      this.recompute();
      void this.maybeAutoAct();
    });
    this.unsubs.push(unsubGame);

    // Presence: mark myself online and let the server clear it if I vanish.
    const presenceRef = ref(this.db, P.presence(code, this.mySeat));
    const connectedRef = ref(this.db, ".info/connected");
    const unsubConnected = onValue(connectedRef, (snap) => {
      this.connected = snap.val() === true;
      if (this.connected) {
        void onDisconnect(presenceRef)
          .set({ online: false, lastSeen: serverTimestamp() })
          .then(() =>
            set(presenceRef, { online: true, lastSeen: serverTimestamp() })
          )
          .catch(() => {
            /* transient — the heartbeat below will retry */
          });
      }
      this.recompute();
    });
    this.unsubs.push(unsubConnected);

    // Heartbeat: refreshes lastSeen so the 60-second absence checks the rules
    // enforce reflect reality, and re-runs upkeep in case an event was missed.
    this.watchdog = setInterval(() => {
      if (this.destroyed) return;
      if (this.connected) {
        void set(presenceRef, {
          online: true,
          lastSeen: serverTimestamp(),
        }).catch(() => undefined);
      }
      this.recompute();
      void this.maybeAutoAct();
    }, 20_000);

    // Wait for the first payload so callers get a populated snapshot.
    await get(gameRef).then((snap) => {
      this.ingest(snap.val() as Record<string, unknown> | null);
      this.recompute();
    });
  }

  private ingest(value: Record<string, unknown> | null): void {
    if (!value) return;
    this.lobby = (value.lobby as LobbyInfo) ?? this.lobby;
    this.seats = (value.seats as Record<string, SeatInfo>) ?? {};
    this.start = (value.start as StartInfo) ?? null;
    this.presence = (value.presence as typeof this.presence) ?? {};
    this.result = (value.result as GameResult) ?? null;
    this.readyFlags = (value.nextReady as Flags) ?? {};
    this.leaveFlags = (value.leave as Flags) ?? {};
    this.forfeitFlags = (value.forfeits as Flags) ?? {};
    this.rematchCode = (value.rematch as { code?: string })?.code ?? null;
    this.publicState = (value.state as PublicState) ?? null;

    const courses = (value.courses as Record<string, unknown>) ?? {};
    this.courses = new Map();
    for (const [key, raw] of Object.entries(courses)) {
      const data = raw as { deal?: unknown; actions?: Record<string, WireAction> };
      const actions = new Map<string, OnlineAction>();
      for (const [actionId, wire] of Object.entries(data.actions ?? {})) {
        const parsed = fromWireAction(wire);
        if (parsed) actions.set(actionId, parsed);
      }
      this.courses.set(key, { dealt: !!data.deal, actions });
    }

    // Surface the newest action so the bridge can play the sound of a move
    // somebody else made. Nothing fires during the first sync: catching up on
    // a race in progress must not replay every noise at once.
    const current = this.publicState?.course;
    const model = current ? this.courses.get(current) : null;
    if (model && model.actions.size > 0) {
      const newest = [...model.actions.keys()].sort().pop()!;
      if (newest !== this.lastActionKey) {
        this.lastActionKey = newest;
        this.lastAction = this.live
          ? { ...model.actions.get(newest)!, key: newest }
          : null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  private get maxPlayers(): number {
    return this.lobby?.maxPlayers ?? MIN_PLAYERS;
  }

  private get seatedCount(): number {
    let n = 0;
    for (let s = 0; s < this.maxPlayers; s++) if (this.seats[String(s)]) n++;
    return n;
  }

  private get playerCount(): number {
    return this.start?.count ?? 0;
  }

  private get currentCourse(): string | null {
    return this.publicState?.course ?? null;
  }

  private replayConfig(): ReplayConfig {
    const count = this.playerCount || this.seatedCount;
    return {
      names: Array.from(
        { length: count },
        (_, s) => this.seats[String(s)]?.name ?? `Coureur ${s + 1}`
      ),
      scoreLimit: this.lobby?.scoreLimit ?? 200,
      roundLimit: this.lobby?.roundLimit ?? null,
      // A lobby created before Coups bas existed carries neither field, and
      // was played under the original rules.
      ruleset: this.lobby?.ruleset ?? "classique",
      brutal: this.lobby?.brutal ?? false,
      playerCount: count,
    };
  }

  /** Course inputs in order, ready for the replay. */
  private courseInputs(): CourseInput[] {
    const keys = [...this.courses.keys()].sort(
      (a, b) => courseNumber(a) - courseNumber(b)
    );
    return keys.map((key) => {
      const model = this.courses.get(key)!;
      const actions = [...model.actions.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, action]) => action);
      return { course: courseNumber(key), actions };
    });
  }

  private recompute(): void {
    if (this.start) {
      const inputs = this.courseInputs();
      this.replay = inputs.length > 0 ? replayGame(this.replayConfig(), inputs) : null;
    } else {
      this.replay = null;
    }
    this.snapshot = this.buildSnapshot();
    this.emit();
  }

  private buildSnapshot(): OnlineSnapshot {
    const game = this.replay?.state ?? null;
    const now = Date.now();

    const count = this.playerCount || this.seatedCount;
    const players: OnlinePlayerMeta[] = Array.from({ length: count }, (_, seat) => {
      const info = this.seats[String(seat)];
      const presence = this.presence[String(seat)];
      const lastSeen = typeof presence?.lastSeen === "number" ? presence.lastSeen : null;
      const away =
        presence?.online !== true && lastSeen !== null && now - lastSeen > CLAIM_AFTER_MS;
      const out =
        game?.players[seat]?.out === true ||
        this.leaveFlags[String(seat)] === true ||
        this.forfeitFlags[String(seat)] === true;
      // Only someone the table is actually waiting on can be excluded.
      const blocking = game !== null && game.actor === seat && !out;
      return {
        seat,
        name: info?.name ?? `Coureur ${seat + 1}`,
        isMe: seat === this.mySeat,
        online: presence?.online === true,
        lastSeen,
        out,
        ready: this.readyFlags[String(seat)] === true,
        canExclude: away && blocking && seat !== this.mySeat,
      };
    });

    const over = this.result !== null || game?.phase === "gameOver";
    return {
      status: !this.start ? "lobby" : over ? "over" : "playing",
      code: this.code,
      mySeat: this.mySeat,
      maxPlayers: this.maxPlayers,
      ruleset: this.lobby?.ruleset ?? "classique",
      brutal: this.lobby?.brutal ?? false,
      playerCount: this.playerCount,
      isHost: this.mySeat === 0,
      started: this.start !== null,
      canStartEarly:
        this.mySeat === 0 && !this.start && this.seatedCount >= MIN_PLAYERS,
      players,
      scoreLimit: this.lobby?.scoreLimit ?? 200,
      roundLimit: this.lobby?.roundLimit ?? null,
      game,
      corrupted: this.replay?.corrupted === true,
      myTurn: game !== null && game.actor === this.mySeat && !over,
      connected: this.connected,
      result: this.result,
      myNextReady: this.readyFlags[String(this.mySeat)] === true,
      rematchCode: this.rematchCode,
      lastAction: this.lastAction,
      busy: this.busy,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): Unsub {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): OnlineSnapshot {
    return this.snapshot;
  }

  // -------------------------------------------------------------------------
  // Acting
  // -------------------------------------------------------------------------

  private setBusy(value: boolean): void {
    if (this.busy === value) return;
    this.busy = value;
    this.snapshot = this.buildSnapshot();
    this.emit();
    // Data that arrived while we were locked skipped its upkeep pass; run it
    // now that the lock is released.
    if (!value) queueMicrotask(() => void this.maybeAutoAct());
  }

  /** Writes my peek marker, then reads the one secret it unlocks. */
  private async peekValue(course: string, cardRef: string): Promise<number> {
    await set(ref(this.db, P.peek(this.code, course, this.mySeat)), cardRef);
    const snap = await get(ref(this.db, P.secretCard(this.code, course, cardRef)));
    const value = snap.val();
    if (typeof value !== "number") {
      throw new OnlineError("network", "peek failed");
    }
    return value;
  }

  async dispatch(action: GameAction): Promise<void> {
    const replay = this.replay;
    const course = this.currentCourse;
    if (!replay || !course || this.busy || this.destroyed) return;
    if (replay.state.actor !== this.mySeat) return;

    this.setBusy(true);
    try {
      const online = await this.toOnlineAction(action, course, replay);
      if (online) await this.commitAction(course, replay, online);
    } finally {
      this.setBusy(false);
    }
  }

  private async toOnlineAction(
    action: GameAction,
    course: string,
    replay: ReplayResult
  ): Promise<OnlineAction | null> {
    const seat = this.mySeat;
    switch (action.type) {
      case "hit": {
        const cardRef = replay.cursorRef;
        const value = await this.peekValue(course, cardRef);
        return { seat, type: "hit", ref: cardRef, value };
      }
      case "stay":
        return { seat, type: "stay" };
      case "assign":
        return { seat, type: "assign", target: action.target };
      case "pick":
        // The card is face up in a lane already, so its ref carries no secret
        // and needs no peek marker.
        return { seat, type: "pick", ref: action.ref };
      default:
        return null;
    }
  }

  private async commitAction(
    course: string,
    replay: ReplayResult,
    online: OnlineAction,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    // Predict the post-action state by replaying locally with it appended.
    const inputs = this.courseInputs();
    const current = inputs[inputs.length - 1];
    const predicted = replayGame(this.replayConfig(), [
      ...inputs.slice(0, -1),
      { ...current, actions: [...current.actions, online] },
    ]);
    if (predicted.corrupted) return; // illegal locally — never send it

    const settled =
      predicted.state.phase === "roundOver" || predicted.state.phase === "gameOver";
    const state: PublicState = {
      course,
      next: actionKey(predicted.actionCount),
      // While a race settles (scores, next deal) the writer keeps the pen: it
      // is the seat responsible for the upkeep writes that follow.
      actor: settled ? wireSeat(this.mySeat) : wireSeat(predicted.state.actor),
      phase: settled
        ? "settling"
        : (predicted.state.phase as PublicState["phase"]),
      cursorRef: predicted.cursorRef,
      nextCourse: courseKey(courseNumber(course) + 1),
    };

    await update(ref(this.db), {
      [P.action(this.code, course, actionKey(replay.actionCount))]: {
        ...toWireAction(online),
        at: serverTimestamp(),
      },
      [P.state(this.code)]: state,
      ...extra,
    });
  }

  /** Appends a rules-checked forfeit for `seat` and mirrors the flag node. */
  private async commitForfeit(seat: Seat): Promise<void> {
    const replay = this.replay;
    const course = this.currentCourse;
    if (!replay || !course) return;
    if (replay.state.players[seat]?.out) return; // already applied
    const extra = this.forfeitFlags[String(seat)]
      ? {}
      : { [P.forfeit(this.code, seat)]: true };
    await this.commitAction(course, replay, { seat, type: "forfeit" }, extra);
  }

  // -------------------------------------------------------------------------
  // Protocol upkeep — reactive, idempotent, crash-safe
  // -------------------------------------------------------------------------

  private autoActing = false;

  /**
   * Upkeep writes are best effort — the state they are derived from will still
   * be there next event, so a failure costs a beat rather than the game. But
   * swallowing them silently makes a stalled table impossible to diagnose, so
   * they are always reported.
   */
  private reportUpkeep(what: string, error: unknown): void {
    console.warn(`[flip-sprint] écriture "${what}" refusée :`, error);
  }

  private async maybeAutoAct(): Promise<void> {
    if (this.destroyed || this.autoActing || this.busy) return;
    this.autoActing = true;
    try {
      // 0) Lobby full → pin the start. Idempotent, first writer wins; the host
      //    writes at once, guests only as a delayed fallback.
      if (!this.start && this.lobby && this.seatedCount === this.maxPlayers) {
        if (this.mySeat !== 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          if (this.start || this.destroyed) return;
        }
        await this.writeStart(this.maxPlayers);
        return;
      }

      const replay = this.replay;
      const course = this.currentCourse;
      if (!replay || !course || replay.corrupted) return;
      const state = replay.state;

      // Only the seat holding the pen performs upkeep.
      const holder = this.publicState?.actor;
      if (holder !== wireSeat(this.mySeat)) return;

      // 1) Someone posted a leave intent → turn it into a log entry, so every
      //    device applies the departure at the same point in the sequence.
      for (let seat = 0; seat < state.players.length; seat++) {
        if (
          this.leaveFlags[String(seat)] === true &&
          !state.players[seat].out &&
          state.phase !== "roundOver" &&
          state.phase !== "gameOver"
        ) {
          await this.commitForfeit(seat);
          return;
        }
      }

      // 2) The game is decided → record the result once.
      if (state.phase === "gameOver" && !this.result) {
        await this.writeResult(state);
        return;
      }

      // 3) A race ended and everyone still in is ready → deal the next one.
      if (state.phase === "roundOver" && !this.result) {
        const waiting = activeSeats(state.players).filter(
          (seat) => this.readyFlags[String(seat)] !== true
        );
        if (waiting.length === 0) {
          await this.dealNextCourse(courseNumber(course) + 1);
        }
      }
    } catch {
      // Upkeep is best effort: it is re-derived from state on the next event,
      // so a failed attempt costs nothing but a beat.
    } finally {
      this.autoActing = false;
    }
  }

  private async writeStart(count: number): Promise<void> {
    await set(ref(this.db, P.start(this.code)), {
      count,
      at: serverTimestamp(),
    }).catch((error) => this.reportUpkeep("start", error));
  }

  private async writeResult(state: GameState): Promise<void> {
    const top = leaders(state.players);
    const winner = top.length === 1 ? top[0] : -1;
    await set(ref(this.db, P.result(this.code)), {
      winner,
      reason: activeCount(state.players) <= 1 ? "abandon" : "score",
      by: wireSeat(this.mySeat),
    }).catch((error) => this.reportUpkeep("result", error));
  }

  private async dealNextCourse(next: number): Promise<void> {
    const key = courseKey(next);
    if (this.courses.get(key)?.dealt) return; // already dealt
    // Every course of a game is dealt from the same deck as the first: the
    // ruleset was frozen in the lobby.
    const deal = generateDeal(this.lobby?.ruleset ?? "classique");
    const replay = this.replay;
    if (!replay) return;

    // Who opens the next course must match what the engine will compute.
    const seats = activeSeats(replay.state.players);
    const first = seats[(next - 1) % Math.max(1, seats.length)] ?? 0;

    const state: PublicState = {
      course: key,
      next: actionKey(0),
      actor: wireSeat(first),
      phase: "draw",
      cursorRef: deckRef(0),
      nextCourse: courseKey(next + 1),
    };

    await update(ref(this.db), {
      [P.deal(this.code, key)]: { at: serverTimestamp() },
      [P.secretCourse(this.code, key)]: deal.secrets,
      [P.state(this.code)]: state,
      [P.nextReady(this.code)]: null, // clear the handshake for the new race
    }).catch((error) => this.reportUpkeep(`deal ${key}`, error));
  }

  // -------------------------------------------------------------------------
  // Commands from the UI
  // -------------------------------------------------------------------------

  async startEarly(): Promise<void> {
    if (this.mySeat !== 0 || this.start) return;
    if (this.seatedCount < MIN_PLAYERS) return;
    await this.writeStart(this.seatedCount);
  }

  async setNextReady(): Promise<void> {
    await set(ref(this.db, P.ready(this.code, this.mySeat)), true).catch(
      () => undefined
    );
    void this.maybeAutoAct();
  }

  /** Leave the game: post the intent, and let the actor enter it in the log. */
  async abandon(): Promise<void> {
    await set(ref(this.db, P.leave(this.code, this.mySeat)), true).catch(
      () => undefined
    );
    // If I happen to hold the pen, enter it myself right away.
    if (this.publicState?.actor === wireSeat(this.mySeat)) {
      await this.commitForfeit(this.mySeat).catch(() => undefined);
    }
    clearOnlineSession();
  }

  /** Exclude a runner the table has been waiting on for over a minute. */
  async excludePlayer(seat: Seat): Promise<void> {
    const meta = this.snapshot.players[seat];
    if (!meta?.canExclude) return;
    await this.commitForfeit(seat).catch(() => undefined);
  }

  async cancelLobby(): Promise<void> {
    if (this.mySeat !== 0 || this.start) return;
    await update(ref(this.db), {
      [P.game(this.code)]: null,
      [P.secrets(this.code)]: null,
    }).catch(() => undefined);
    clearOnlineSession();
  }

  /** Opens a fresh race and points this one at it, so everyone can follow. */
  async requestRematch(name: string): Promise<OnlineGame> {
    if (this.rematchCode) return OnlineGame.join(this.rematchCode, name);
    const next = await OnlineGame.create(
      name,
      this.snapshot.scoreLimit,
      this.snapshot.roundLimit,
      this.snapshot.maxPlayers
    );
    await set(ref(this.db, P.rematch(this.code)), {
      code: next.code,
      by: wireSeat(this.mySeat),
    }).catch(() => undefined);
    return next;
  }

  /** Leaves a finished race and clears it from the database. */
  async cleanup(): Promise<void> {
    clearOnlineSession();
    if (this.snapshot.status !== "over") return;
    await update(ref(this.db), {
      [P.game(this.code)]: null,
      [P.secrets(this.code)]: null,
    }).catch(() => undefined);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.listeners.clear();
  }
}
