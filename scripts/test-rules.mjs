// Security probes against the real database rules, on the emulator.
//
// These are the tests that matter for an online game people can reach: every
// one of them is an attack a modified client could actually attempt, run with
// a genuine player's credentials. A green run means the rules — not the app —
// are what stops them.
//
//   node scripts/test-rules.mjs
//
// Requires Java (the database emulator runs on the JVM).

import process from "node:process";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  ref,
  serverTimestamp,
  set,
  update,
} from "firebase/database";
import { startEmulators } from "./emulators.mjs";

const PROJECT = "flip-sprint-live";
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

/** Runs `fn`, and reports whether it was refused by the rules. */
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

/** One signed-in client, standing in for one phone. */
const makeClient = async (name) => {
  const app = initializeApp(
    {
      apiKey: "emulator",
      authDomain: `${PROJECT}.firebaseapp.com`,
      databaseURL: `http://127.0.0.1:9000/?ns=${PROJECT}-default-rtdb`,
      projectId: PROJECT,
      appId: "1:0:web:0",
    },
    name
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  const credential = await signInAnonymously(auth);
  return { app, db, uid: credential.user.uid, name };
};

/** A freshly created race with `hostClient` in seat 0. */
const createRace = async (host, code, maxPlayers = 3, overrides = {}) => {
  const secrets = {};
  // A known deck, so the probes can predict what a legal move looks like.
  for (let i = 0; i < 94; i++) secrets[i] = (i % 12) + 1;

  await update(ref(host.db), {
    [`games/${code}`]: {
      lobby: {
        hostName: host.name,
        scoreLimit: 200,
        roundLimit: null,
        maxPlayers,
        createdAt: serverTimestamp(),
      },
      seats: { 0: { uid: host.uid, name: host.name } },
      state: {
        course: "c1",
        next: "a0000",
        actor: "0",
        phase: "draw",
        cursorRef: "d/0",
        nextCourse: "c2",
        ...overrides,
      },
      courses: { c1: { deal: { at: serverTimestamp() } } },
    },
    [`secrets/${code}/c1`]: { d: secrets },
  });
};

const main = async () => {
  console.log("démarrage des émulateurs…");
  const { stop } = await startEmulators();
  let alice, bob, mallory;

  try {
    alice = await makeClient("alice");
    bob = await makeClient("bob");
    mallory = await makeClient("mallory");

    // ---------------------------------------------------------------------
    console.log("\ncréation et sièges");
    const code = "AAAAAA";
    check(await allowed(() => createRace(alice, code)), "l'hôte peut créer une partie");

    check(
      await denied(() =>
        set(ref(mallory.db, `games/${code}/seats/2`), {
          uid: mallory.uid,
          name: "mallory",
        })
      ),
      "un siège non contigu est refusé (2 avant 1)"
    );

    check(
      await allowed(() =>
        set(ref(bob.db, `games/${code}/seats/1`), { uid: bob.uid, name: "bob" })
      ),
      "le siège libre suivant peut être pris"
    );

    check(
      await denied(() =>
        set(ref(mallory.db, `games/${code}/seats/1`), {
          uid: mallory.uid,
          name: "mallory",
        })
      ),
      "un siège déjà pris ne peut pas être volé"
    );

    check(
      await denied(() =>
        set(ref(mallory.db, `games/${code}/seats/2`), {
          uid: alice.uid,
          name: "usurpation",
        })
      ),
      "on ne peut pas asseoir quelqu'un d'autre à sa place"
    );

    // ---------------------------------------------------------------------
    console.log("\nlecture de la partie");
    check(
      await denied(() => get(ref(mallory.db, `games/${code}`))),
      "un inconnu ne peut pas lire la partie"
    );
    check(
      await allowed(() => get(ref(bob.db, `games/${code}`))),
      "un joueur assis peut lire la partie"
    );

    // ---------------------------------------------------------------------
    console.log("\nsecrets — l'ordre de la pioche");
    check(
      await denied(() => get(ref(alice.db, `secrets/${code}`))),
      "les secrets ne sont pas lisibles en bloc"
    );
    check(
      await denied(() => get(ref(alice.db, `secrets/${code}/c1/d`))),
      "le paquet d'une course n'est pas lisible en bloc"
    );
    check(
      await denied(() => get(ref(alice.db, `secrets/${code}/c1/d/0`))),
      "une carte n'est pas lisible sans marqueur de lecture"
    );

    // Alice is the actor: she marks the card she is about to take.
    check(
      await allowed(() => set(ref(alice.db, `games/${code}/courses/c1/peek/0`), "d/0")),
      "l'acteur peut poser son marqueur de lecture"
    );
    check(
      await allowed(() => get(ref(alice.db, `secrets/${code}/c1/d/0`))),
      "l'acteur lit la carte que son marqueur désigne"
    );
    check(
      await denied(() => get(ref(alice.db, `secrets/${code}/c1/d/1`))),
      "et seulement celle-là : la suivante reste illisible"
    );
    check(
      await denied(() => set(ref(bob.db, `games/${code}/courses/c1/peek/1`), "d/5")),
      "un joueur qui n'est pas l'acteur ne peut pas poser de marqueur"
    );
    check(
      await denied(() => get(ref(bob.db, `secrets/${code}/c1/d/0`))),
      "un joueur qui n'est pas l'acteur ne lit aucun secret"
    );

    // ---------------------------------------------------------------------
    console.log("\njournal d'actions");
    const realValue = 1; // secrets d/0 = (0 % 12) + 1

    check(
      await denied(() =>
        set(ref(bob.db, `games/${code}/courses/c1/actions/a0000`), {
          seat: "1",
          type: "hit",
          ref: "d/0",
          value: realValue,
        })
      ),
      "jouer hors de son tour est refusé"
    );

    check(
      await denied(() =>
        set(ref(alice.db, `games/${code}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "hit",
          ref: "d/0",
          value: 12,
        })
      ),
      "mentir sur la valeur d'une carte est refusé"
    );

    check(
      await denied(() =>
        set(ref(alice.db, `games/${code}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "hit",
          ref: "d/7",
          value: 8,
        })
      ),
      "piocher ailleurs qu'au curseur est refusé"
    );

    check(
      await denied(() =>
        set(ref(alice.db, `games/${code}/courses/c1/actions/a0005`), {
          seat: "0",
          type: "hit",
          ref: "d/0",
          value: realValue,
        })
      ),
      "écrire hors de la clé attendue est refusé"
    );

    check(
      await denied(() =>
        set(ref(alice.db, `games/${code}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "stay",
        })
      ),
      "souffler pendant une pioche forcée est refusé"
    );

    check(
      await allowed(() =>
        update(ref(alice.db), {
          [`games/${code}/courses/c1/actions/a0000`]: {
            seat: "0",
            type: "hit",
            ref: "d/0",
            value: realValue,
          },
          [`games/${code}/state`]: {
            course: "c1",
            next: "a0001",
            actor: "1",
            phase: "draw",
            cursorRef: "d/1",
            nextCourse: "c2",
          },
        })
      ),
      "un coup légal de l'acteur passe"
    );

    check(
      await denied(() =>
        set(ref(alice.db, `games/${code}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "stay",
        })
      ),
      "réécrire une action déjà inscrite est refusé (journal append-only)"
    );

    check(
      await denied(() =>
        update(ref(alice.db), {
          [`games/${code}/state`]: {
            course: "c1",
            next: "a0002",
            actor: "0",
            phase: "draw",
            cursorRef: "d/2",
            nextCourse: "c2",
          },
        })
      ),
      "reprendre la main alors que c'est au tour d'un autre est refusé"
    );

    // ---------------------------------------------------------------------
    console.log("\nabandons et exclusions");
    check(
      await denied(() =>
        set(ref(bob.db, `games/${code}/courses/c1/actions/a0001`), {
          seat: "0",
          type: "forfeit",
        })
      ),
      "exclure un joueur présent qui n'a rien demandé est refusé"
    );

    check(
      await allowed(() => set(ref(bob.db, `games/${code}/leave/1`), true)),
      "un joueur peut signer son propre départ"
    );
    check(
      await denied(() => set(ref(mallory.db, `games/${code}/leave/0`), true)),
      "on ne peut pas signer le départ de quelqu'un d'autre"
    );

    // ---------------------------------------------------------------------
    console.log("\ndémarrage");
    const other = "BBBBBB";
    await createRace(alice, other, 3);
    await set(ref(bob.db, `games/${other}/seats/1`), { uid: bob.uid, name: "bob" });
    check(
      await denied(() =>
        set(ref(alice.db, `games/${other}/start`), { count: 3, at: serverTimestamp() })
      ),
      "démarrer avec plus de joueurs qu'assis est refusé"
    );
    check(
      await allowed(() =>
        set(ref(alice.db, `games/${other}/start`), { count: 2, at: serverTimestamp() })
      ),
      "démarrer avec les joueurs réellement assis passe"
    );
    check(
      await denied(() =>
        set(ref(mallory.db, `games/${other}/seats/2`), {
          uid: mallory.uid,
          name: "mallory",
        })
      ),
      "rejoindre une partie déjà commencée est refusé"
    );

    // ---------------------------------------------------------------------
    // Coups bas adds an action that points at a card already face up in a
    // lane. The database has never seen a lane, so it cannot check that the
    // card is really there — that is caught by every other device's replay.
    // What it CAN hold is who may speak, and when.
    console.log("\nCoups bas — l'action « pick »");
    const cb = "DDDDDD";
    await createRace(alice, cb, 3, { phase: "picking" });
    await set(ref(bob.db, `games/${cb}/seats/1`), { uid: bob.uid, name: "bob" });

    check(
      await allowed(() =>
        set(ref(alice.db, `games/${cb}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "pick",
          ref: "d/3",
        })
      ),
      "l'acteur peut désigner une carte pendant la phase de sélection"
    );

    check(
      await denied(() =>
        set(ref(bob.db, `games/${cb}/courses/c1/actions/a0001`), {
          seat: "1",
          type: "pick",
          ref: "d/4",
        })
      ),
      "un joueur qui n'est pas l'acteur ne peut désigner aucune carte"
    );

    const other2 = "EEEEEE";
    await createRace(alice, other2, 3);
    check(
      await denied(() =>
        set(ref(alice.db, `games/${other2}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "pick",
          ref: "d/1",
        })
      ),
      "désigner une carte hors de la phase de sélection est refusé"
    );

    // ---------------------------------------------------------------------
    // Nuit noire settles a Sprint parfait by pointing at a runner, which is
    // the same wire action as handing out a card — so the rules must open the
    // "bounty" phase to it, and to nobody but the actor.
    console.log("\nNuit noire — le choix du Sprint parfait");
    const nb = "GGGGGG";
    await createRace(alice, nb, 3, { phase: "bounty" });
    await set(ref(bob.db, `games/${nb}/seats/1`), { uid: bob.uid, name: "bob" });

    check(
      await allowed(() =>
        set(ref(alice.db, `games/${nb}/courses/c1/actions/a0000`), {
          seat: "0",
          type: "assign",
          target: "1",
        })
      ),
      "l'auteur du Sprint parfait peut désigner sa cible"
    );
    check(
      await denied(() =>
        set(ref(bob.db, `games/${nb}/courses/c1/actions/a0001`), {
          seat: "1",
          type: "assign",
          target: "0",
        })
      ),
      "personne d'autre ne décide à sa place"
    );

    // ---------------------------------------------------------------------
    console.log("\nle jeu de règles est figé");
    check(
      await denied(() =>
        set(ref(alice.db, `games/${other2}/lobby/ruleset`), "coupsbas")
      ),
      "changer les règles d'une partie en cours est refusé"
    );
    check(
      await denied(() =>
        update(ref(alice.db), {
          [`games/FFFFFF`]: {
            lobby: {
              hostName: "alice",
              scoreLimit: 200,
              roundLimit: null,
              maxPlayers: 2,
              ruleset: "triche",
              createdAt: serverTimestamp(),
            },
            seats: { 0: { uid: alice.uid, name: "alice" } },
          },
        })
      ),
      "un jeu de règles inventé est refusé à la création"
    );

    // ---------------------------------------------------------------------
    // Realtime Database rules CASCADE: a `.write` granted on a parent grants
    // it on every descendant, whatever their own rules say. A blanket grant
    // high in the secrets tree would therefore let a seated player rewrite a
    // deck mid-course — and publish values matching their new deck, which the
    // per-action check would happily accept.
    console.log("\ncascade des règles sur les secrets");
    check(
      await denied(() =>
        set(ref(alice.db, `secrets/${code}/c1/d/40`), 12)
      ),
      "réécrire une carte du paquet en cours est refusé"
    );
    check(
      await denied(() =>
        set(ref(alice.db, `secrets/${code}/c1`), { d: { 0: 12, 1: 12 } })
      ),
      "réécrire tout le paquet d'une course est refusé"
    );
    check(
      await denied(() => set(ref(alice.db, `secrets/${code}`), { c1: { d: { 0: 12 } } })),
      "réécrire l'arbre des secrets est refusé"
    );

    // ---------------------------------------------------------------------
    // Finished games must be removable, or every race ever played piles up.
    console.log("\nménage");
    const spare = "CCCCCC";
    await createRace(alice, spare, 2);
    check(
      await allowed(() =>
        update(ref(alice.db), {
          [`games/${spare}`]: null,
          [`secrets/${spare}`]: null,
        })
      ),
      "un salon jamais démarré peut être effacé"
    );
    check(
      await denied(() => set(ref(mallory.db, `games/${code}`), null)),
      "un inconnu ne peut pas effacer une partie"
    );
  } finally {
    for (const client of [alice, bob, mallory]) {
      if (client) await deleteApp(client.app).catch(() => undefined);
    }
    stop();
  }

  console.log(`\n${passed} sondes passées, ${failures.length} échec(s)`);
  if (failures.length > 0) {
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
};

await main();
// The emulator keeps a handle open that `stop()` does not always release, and
// a probe suite that never returns is a probe suite nobody runs. Every check
// has reported by this point, so leaving is safe.
process.exit(0);
