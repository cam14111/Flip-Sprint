// Checks the *real* Firebase project, not the emulator.
//
// Answers the two questions that matter after a deployment:
//   1. does anonymous sign-in work? (API key correct, anonymous auth enabled)
//   2. are our security rules live, or is the database still in locked mode?
//
//   npm run check:live
//
// A database left in locked mode is safe but completely non-functional: every
// read and write is denied, so the online mode simply never connects.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { get, getDatabase, ref } from "firebase/database";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Reads the same defaults the app ships with, so the two cannot drift. */
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

const config = readConfig();
console.log(`projet : ${config.projectId}`);

if (config.apiKey.startsWith("A_RENSEIGNER")) {
  console.error("La configuration Firebase n'est pas renseignée.");
  process.exit(1);
}

const app = initializeApp(config);

try {
  const credential = await signInAnonymously(getAuth(app));
  console.log(`auth   : OK (uid anonyme ${credential.user.uid.slice(0, 8)}…)`);
} catch (error) {
  console.error(`auth   : ÉCHEC — ${error.code ?? error.message}`);
  console.error("  → vérifier la clé d'API et que la connexion anonyme est activée");
  process.exit(1);
}

// `games/{code}/lobby` is readable by any signed-in user once our rules are
// live; locked mode denies it. Either answer proves the database responds —
// which one tells us whether the rules made it there.
try {
  await get(ref(getDatabase(app), "games/ZZZZZZ/lobby"));
  console.log("règles : OK — les règles du dépôt sont déployées");
  process.exit(0);
} catch (error) {
  const message = String(error);
  if (/permission|PERMISSION_DENIED/i.test(message)) {
    console.error("règles : la base répond mais REFUSE tout — mode verrouillé");
    console.error("  → déployer database.rules.json avant de jouer :");
    console.error("     npx firebase login && npx firebase deploy --only database");
    console.error("     (ou coller le fichier dans Console → Realtime Database → Règles)");
    process.exit(1);
  }
  console.error(`base   : INJOIGNABLE — ${message.slice(0, 200)}`);
  process.exit(1);
}
