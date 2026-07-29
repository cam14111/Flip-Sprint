// Local pointer to the online race this device belongs to.
//
// This is what makes "close the app, reopen it, land back in your race" work:
// the anonymous Firebase uid survives in IndexedDB, and this record says which
// game — and which seat — that uid belongs to.

import { MAX_PLAYERS, Seat } from "./protocol";

export interface OnlineSession {
  code: string;
  seat: Seat;
  name: string;
}

const KEY = "flip-sprint:online-session";

export const loadOnlineSession = (): OnlineSession | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnlineSession;
    if (
      typeof parsed?.code !== "string" ||
      !Number.isInteger(parsed?.seat) ||
      parsed.seat < 0 ||
      parsed.seat >= MAX_PLAYERS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const saveOnlineSession = (session: OnlineSession): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — resuming won't survive a reload */
  }
};

export const clearOnlineSession = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
