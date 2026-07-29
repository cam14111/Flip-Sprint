// Firebase bootstrap for the online mode.
//
// Loaded lazily (dynamic import) so the SDK never weighs down solo or local
// play, and the offline PWA does not depend on it at all.
//
// The web config below is public by design — a Firebase web API key is an
// identifier, not a secret, and access control lives entirely in the database
// rules. Values can be overridden at build time through VITE_FIREBASE_* env
// vars, which is also how the end-to-end tests point at the local emulators.

import { FirebaseApp, initializeApp } from "firebase/app";
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import { connectDatabaseEmulator, Database, getDatabase } from "firebase/database";

const env = import.meta.env;

/** Placeholder marker: the online mode stays disabled until these are real. */
const PLACEHOLDER = "A_RENSEIGNER";

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? PLACEHOLDER,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "flip-sprint-live.firebaseapp.com",
  databaseURL:
    env.VITE_FIREBASE_DATABASE_URL ??
    "https://flip-sprint-live-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "flip-sprint-live",
  appId: env.VITE_FIREBASE_APP_ID ?? PLACEHOLDER,
};

const emulatorsEnabled = (): boolean => env.VITE_FIREBASE_EMULATORS === "1";

/** False while the config still holds placeholders — online mode unusable. */
export const isFirebaseConfigured = (): boolean =>
  emulatorsEnabled() ||
  (!firebaseConfig.apiKey.startsWith(PLACEHOLDER) &&
    !firebaseConfig.appId.startsWith(PLACEHOLDER));

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

const init = (): { auth: Auth; db: Database } => {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getDatabase(app);
    if (emulatorsEnabled()) {
      const host = location.hostname || "localhost";
      connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
      connectDatabaseEmulator(db, host, 9000);
    }
    if (env.DEV) {
      // Dev-only handle for the end-to-end security probes, which attempt
      // direct reads and writes with a *real* player's credentials to prove
      // the database rules hold. Stripped from production builds.
      void import("firebase/database").then((m) => {
        (window as unknown as { __fsdb?: unknown }).__fsdb = {
          db,
          ref: m.ref,
          get: m.get,
          set: m.set,
          update: m.update,
        };
      });
    }
  }
  return { auth: auth!, db: db! };
};

/**
 * Signs in anonymously. Idempotent: Firebase keeps the anonymous user in
 * IndexedDB, so the same uid survives reloads and app restarts — which is
 * exactly what makes seamless reconnection possible without any account.
 */
export const ensureSignedIn = async (): Promise<{
  uid: string;
  db: Database;
}> => {
  const { auth, db } = init();
  if (auth.currentUser) return { uid: auth.currentUser.uid, db };
  const credential = await signInAnonymously(auth);
  return { uid: credential.user.uid, db };
};

export const getDb = (): Database => init().db;
