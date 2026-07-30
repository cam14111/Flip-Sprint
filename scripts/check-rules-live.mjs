// Confirms the deployed rules are the ones in this repository — specifically
// that the cascade fix is live.
//
//   npm run check:rules-live
//
// `check:live` only proves that *some* rules are deployed. This runs the two
// probes that distinguish the corrected rules from the flawed ones they
// replaced: rewriting a deck mid-course must be refused, and a finished race
// must be removable.
//
// It writes a handful of records to the REAL database, under a random code,
// and deletes them on the way out.

import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { get, getDatabase, ref, serverTimestamp, set, update } from "firebase/database";

const __dirname = dirname(fileURLToPath(import.meta.url));

const readConfig = () => {
  const source = readFileSync(
    resolve(__dirname, "..", "src", "online", "firebase.ts"),
    "utf8"
  );
  const pick = (key) => {
    const match = new RegExp(
      `${key}:\\s*(?:\\n\\s*)?env\\.VITE_[A-Z_]+ \\?\\?\\s*(?:\\n\\s*)?"([^"]+)"`
    ).exec(source);
    if (!match) throw new Error(`config introuvable : ${key}`);
    return match[1];
  };
  return {
    apiKey: pick("apiKey"),
    authDomain: pick("authDomain"),
    databaseURL: pick("databaseURL"),
    projectId: pick("projectId"),
    appId: pick("appId"),
  };
};

let passed = 0;
const failures = [];
const check = (ok, label) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL ${label}`);
  }
};

const denied = async (fn) => {
  try {
    await fn();
    return false;
  } catch (error) {
    return /permission|PERMISSION_DENIED/i.test(String(error));
  }
};

const allowed = async (fn) => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};

/** A code unlikely to collide with anybody's real race. */
const probeCode = () => {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTWXZ";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
};

const config = readConfig();
const app = initializeApp(config, "probe");
const db = getDatabase(app);
const { user } = await signInAnonymously(getAuth(app));
const uid = user.uid;
const code = probeCode();
console.log(`projet : ${config.projectId} · partie de test : ${code}`);

try {
  const secrets = {};
  for (let i = 0; i < 94; i++) secrets[i] = (i % 12) + 1;

  check(
    await allowed(() =>
      update(ref(db), {
        [`games/${code}`]: {
          lobby: {
            hostName: "sonde",
            scoreLimit: 200,
            roundLimit: null,
            maxPlayers: 2,
            createdAt: serverTimestamp(),
          },
          seats: { 0: { uid, name: "sonde" } },
          state: {
            course: "c1",
            next: "a0000",
            actor: "0",
            phase: "draw",
            cursorRef: "d/0",
            nextCourse: "c2",
          },
          courses: { c1: { deal: { at: serverTimestamp() } } },
        },
        [`secrets/${code}/c1`]: { d: secrets },
      })
    ),
    "une partie peut être créée"
  );

  check(
    await denied(() => get(ref(db, `secrets/${code}/c1/d`))),
    "le paquet n'est pas lisible en bloc"
  );

  // The two probes that tell the corrected rules from the flawed ones.
  check(
    await denied(() => set(ref(db, `secrets/${code}/c1/d/40`), 12)),
    "réécrire une carte du paquet en cours est refusé (correction en place)"
  );
  check(
    await denied(() => set(ref(db, `secrets/${code}`), { c1: { d: { 0: 12 } } })),
    "réécrire l'arbre des secrets est refusé (correction en place)"
  );
} finally {
  const cleaned = await allowed(() =>
    update(ref(db), { [`games/${code}`]: null, [`secrets/${code}`]: null })
  );
  check(cleaned, "la partie de test est effacée (le ménage est possible)");
  await deleteApp(app).catch(() => undefined);
}

console.log(`\n${passed} vérifications, ${failures.length} échec(s)`);
if (failures.length > 0) {
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
// The realtime connection stays open and would keep Node alive for ever.
process.exit(0);
