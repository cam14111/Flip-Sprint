// React bridge for the online mode.
//
// Owns the OnlineGame client's lifecycle, exposes its snapshot as React state,
// and speaks the same sound and haptic language as local play — for my moves
// and for everyone else's.
//
// Everything under src/online/ (and the Firebase SDK with it) is loaded on
// first use, so solo and local play — and the offline PWA — never pay for it.

import { useCallback, useEffect, useRef, useState } from "react";
import { GameAction, RulesetId } from "@/game/types";
import type {
  OnlineErrorCode,
  OnlineGame,
  OnlineSnapshot,
} from "@/online/client";
import type { OnlineSession } from "@/online/session";
import { playEvents } from "./useGame";

export type OnlineStage =
  | { kind: "menu" }
  | { kind: "connecting"; label: string }
  | { kind: "active" }
  | { kind: "error"; error: OnlineErrorCode };

export interface UseOnlineGame {
  stage: OnlineStage;
  snap: OnlineSnapshot | null;
  create: (
    name: string,
    scoreLimit: number,
    roundLimit: number | null,
    seats: number,
    ruleset?: RulesetId,
    brutal?: boolean
  ) => Promise<void>;
  join: (code: string, name: string) => Promise<void>;
  resume: (session: OnlineSession) => Promise<void>;
  dispatch: (action: GameAction) => void;
  setNextReady: () => void;
  startEarly: () => void;
  abandon: () => Promise<void>;
  excludePlayer: (seat: number) => void;
  requestRematch: (name: string) => Promise<void>;
  cancelLobby: () => Promise<void>;
  /** Detach without leaving — the race stays resumable. */
  detach: () => void;
  /** Leave a finished race and clear it from the database. */
  finish: () => Promise<void>;
  backToMenu: () => void;
}

const loadClient = () => import("@/online/client");

export const useOnlineGame = (): UseOnlineGame => {
  const [stage, setStage] = useState<OnlineStage>({ kind: "menu" });
  const [snap, setSnap] = useState<OnlineSnapshot | null>(null);
  const gameRef = useRef<OnlineGame | null>(null);
  const seenAction = useRef<string | null>(null);

  const detach = useCallback(() => {
    gameRef.current?.destroy();
    gameRef.current = null;
    setSnap(null);
  }, []);

  useEffect(() => detach, [detach]);

  /** Binds a freshly created client and starts mirroring its snapshot. */
  const bind = useCallback((game: OnlineGame) => {
    gameRef.current?.destroy();
    gameRef.current = game;
    seenAction.current = game.getSnapshot().lastAction?.key ?? null;
    setSnap(game.getSnapshot());
    setStage({ kind: "active" });

    game.subscribe(() => {
      const next = game.getSnapshot();
      setSnap(next);

      // Voice moves as they land — including the ones other people made. The
      // engine's own events carry everything needed; replaying them here keeps
      // online and local feeling identical.
      const key = next.lastAction?.key ?? null;
      if (key && key !== seenAction.current) {
        seenAction.current = key;
        if (next.game) playEvents(next.game.events, next.mySeat);
      }
    });
  }, []);

  const guard = useCallback(
    async (label: string, run: () => Promise<OnlineGame>) => {
      setStage({ kind: "connecting", label });
      try {
        const { isFirebaseConfigured } = await import("@/online/firebase");
        if (!isFirebaseConfigured()) {
          setStage({ kind: "error", error: "unconfigured" });
          return;
        }
        bind(await run());
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? ((error as { code: OnlineErrorCode }).code ?? "network")
            : "network";
        setStage({ kind: "error", error: code });
      }
    },
    [bind]
  );

  const create = useCallback(
    async (
      name: string,
      scoreLimit: number,
      roundLimit: number | null,
      seats: number,
      ruleset: RulesetId = "classique",
      brutal = false
    ) => {
      await guard("Création de la partie…", async () => {
        const { OnlineGame } = await loadClient();
        return OnlineGame.create(
          name,
          scoreLimit,
          roundLimit,
          seats,
          ruleset,
          brutal
        );
      });
    },
    [guard]
  );

  const join = useCallback(
    async (code: string, name: string) => {
      await guard("Connexion à la partie…", async () => {
        const { OnlineGame } = await loadClient();
        return OnlineGame.join(code, name);
      });
    },
    [guard]
  );

  const resume = useCallback(
    async (session: OnlineSession) => {
      await guard("Retour dans la course…", async () => {
        const { OnlineGame } = await loadClient();
        return OnlineGame.resume(session.code);
      });
    },
    [guard]
  );

  const dispatch = useCallback((action: GameAction) => {
    void gameRef.current?.dispatch(action);
  }, []);

  const setNextReady = useCallback(() => {
    void gameRef.current?.setNextReady();
  }, []);

  const startEarly = useCallback(() => {
    void gameRef.current?.startEarly();
  }, []);

  const excludePlayer = useCallback((seat: number) => {
    void gameRef.current?.excludePlayer(seat);
  }, []);

  const abandon = useCallback(async () => {
    await gameRef.current?.abandon();
    detach();
    setStage({ kind: "menu" });
  }, [detach]);

  const cancelLobby = useCallback(async () => {
    await gameRef.current?.cancelLobby();
    detach();
    setStage({ kind: "menu" });
  }, [detach]);

  const finish = useCallback(async () => {
    await gameRef.current?.cleanup();
    detach();
    setStage({ kind: "menu" });
  }, [detach]);

  const requestRematch = useCallback(
    async (name: string) => {
      const current = gameRef.current;
      if (!current) return;
      setStage({ kind: "connecting", label: "Nouvelle partie…" });
      try {
        bind(await current.requestRematch(name));
      } catch {
        setStage({ kind: "error", error: "network" });
      }
    },
    [bind]
  );

  const backToMenu = useCallback(() => {
    detach();
    setStage({ kind: "menu" });
  }, [detach]);

  return {
    stage,
    snap,
    create,
    join,
    resume,
    dispatch,
    setNextReady,
    startEarly,
    abandon,
    excludePlayer,
    requestRematch,
    cancelLobby,
    detach,
    finish,
    backToMenu,
  };
};
