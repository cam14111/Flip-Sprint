// Generates database.rules.json.
//
// Realtime Database rules have no functions, so every "is this caller one of
// the eight seats?" check has to be spelled out in full. Written by hand that
// is tens of kilobytes of near-identical JSON where a single wrong index is
// invisible. This script is the source of truth; the JSON it writes is
// committed so deploying never depends on running it.
//
//   npm run build:rules
//
// What the rules actually guarantee:
//   • only a seated player can read or write a race;
//   • seats are claimed one at a time and stay contiguous, and the head count
//     is frozen the moment the race starts;
//   • the action log is append-only — a write must use exactly the key
//     `state.next`, and existing entries can never be altered;
//   • only `state.actor` may act, which during a Rafale is its target and not
//     the seat whose turn it is;
//   • the action type must match the phase the board is in;
//   • a card's value must equal the secret it claims to reveal, and a client
//     may read exactly one secret at a time — the one its own peek marker
//     names, and only while it is the actor;
//   • a runner may only be excluded after 60 seconds of real absence, or once
//     they have signed their own intent to leave.
//
// What they cannot guarantee, and the README says so: the client that deals a
// course knows that course's deck order.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SEATS = [0, 1, 2, 3, 4, 5, 6, 7];

const game = (path) => `root.child('games/' + $code + '${path}')`;
const stateOf = (field) => `${game(`/state/${field}`)}.val()`;

/** The caller occupies seat `n`. */
const isSeat = (n) => `${game(`/seats/${n}/uid`)}.val() === auth.uid`;

/** The caller occupies any seat of this race. */
const isMember = `(${SEATS.map(isSeat).join(" || ")})`;

/** The caller is the seat allowed to act right now. */
const isActor = `${game("/seats/' + " + stateOf("actor") + " + '/uid")}.val() === auth.uid`;

/**
 * `seat` has been unreachable for over a minute, by the server's clock.
 *
 * The presence record must EXIST. Treating a missing record as absence looks
 * harmless — and is a hole: right after joining, before the client has written
 * its first heartbeat, any other player could claim the seat was away and seize
 * the initiative. A probe caught exactly that. Since onDisconnect is armed
 * before the first heartbeat, a genuinely absent player always leaves a record
 * behind, so requiring it costs nothing.
 */
const isAbsent = (seat) =>
  `(${game(`/presence/' + ${seat} + '`)}.exists() && ` +
  `${game(`/presence/' + ${seat} + '/online`)}.val() !== true && ` +
  `${game(`/presence/' + ${seat} + '/lastSeen`)}.isNumber() && ` +
  `now - ${game(`/presence/' + ${seat} + '/lastSeen`)}.val() > 60000)`;

/** `seat` signed their own intent to leave. */
const hasLeft = (seat) => `${game(`/leave/' + ${seat} + '`)}.val() === true`;

/**
 * A race that is finished, or a lobby that never started — the only moments at
 * which a member may sweep it out of the database. Without this, every race
 * ever played piles up forever: the create rule below is write-once, so nothing
 * could ever be removed.
 */
const isDisposable = `(${game("/result")}.exists() || !${game("/start")}.exists())`;

const newSeat = "newData.child('seat').val()";
const newType = "newData.child('type').val()";
const secretAt = (refExpr) =>
  `root.child('secrets/' + $code + '/' + $c + '/' + ${refExpr}).val()`;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Append-only: the key must be exactly the one the state points at, the entry
// must not already exist, and it must belong to the current course.
const actionWrite = [
  "auth != null",
  "!data.exists()",
  `$c === ${stateOf("course")}`,
  `$a === ${stateOf("next")}`,
  // Either the actor is writing their own move, or somebody is entering a
  // forfeit for a seat that has left or gone missing.
  `(${isActor} || (${newType} === 'forfeit' && ${isMember} && ` +
    `(${hasLeft(newSeat)} || ${isAbsent(newSeat)})))`,
].join(" && ");

const playedByActor = `${newSeat} === ${stateOf("actor")}`;
const phaseIs = (...phases) =>
  `(${phases.map((p) => `${stateOf("phase")} === '${p}'`).join(" || ")})`;

const actionValidate = [
  "newData.hasChildren(['seat', 'type'])",
  "newData.child('seat').isString()",
  "newData.child('seat').val().matches(/^[0-7]$/)",
  "(" +
    [
      // Take a card: the ref must be the one the cursor points at, and the
      // value must be the secret sitting there.
      `(${newType} === 'hit' && ${playedByActor} && ${phaseIs("draw", "decide")} && ` +
        `newData.child('ref').val() === ${stateOf("cursorRef")} && ` +
        `newData.child('value').val() === ${secretAt("newData.child('ref').val()")})`,

      // Catch your breath: only ever a free choice, never during a forced draw.
      `(${newType} === 'stay' && ${playedByActor} && ${phaseIs("decide")})`,

      // Hand out an action card: only while one is actually waiting. Nuit
      // noire settles a Sprint parfait with the same gesture — point at a
      // runner — so the two phases share this clause.
      `(${newType} === 'assign' && ${playedByActor} && ${phaseIs("targeting", "bounty")} && ` +
        `newData.child('target').isString() && ` +
        `newData.child('target').val().matches(/^[0-7]$/))`,

      // Coups bas — point at a card in a lane. The database holds the action
      // log and nothing else: it has never seen a lane, so it cannot check
      // that the named card is really there. What it CAN hold is who is
      // allowed to speak and when, which is what this line does. The rest is
      // caught by every other device's replay, which marks the game corrupted
      // rather than accepting a forged move. Same trade, already documented,
      // as the client that shuffles the deck.
      `(${newType} === 'pick' && ${playedByActor} && ${phaseIs("picking")} && ` +
        `newData.child('ref').isString() && ` +
        `newData.child('ref').val().length <= 12)`,

      // Leave: written by that player, or by someone else once they qualify.
      `(${newType} === 'forfeit' && (${game("/seats/' + " + newSeat + " + '/uid")}.val() === auth.uid || ` +
        `${hasLeft(newSeat)} || ${isAbsent(newSeat)}))`,
    ].join(" || ") +
    ")",
].join(" && ");

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

const rules = {
  rules: {
    ".read": false,
    ".write": false,

    games: {
      $code: {
        // Only the people at the table can watch it.
        ".read": `auth != null && ${isMember}`,
        // Two things only: creating a race — the whole node appears at once,
        // with the author in seat 0 and nothing already there — and removing a
        // finished one. Note this grant cascades to descendants, but only ever
        // when the WHOLE node is going away: deleting a single child leaves
        // `newData` at this path existing, so the branch does not apply.
        ".write":
          "auth != null && (" +
          `(!data.exists() && newData.exists() && ` +
          `newData.child('seats/0/uid').val() === auth.uid && ` +
          `newData.child('state/course').val() === 'c1' && ` +
          `newData.child('state/actor').val() === '0') || ` +
          `(!newData.exists() && ${isMember} && ${isDisposable})` +
          ")",

        lobby: {
          // Readable by anyone signed in: joining needs the head count before
          // a seat exists to prove membership.
          ".read": "auth != null",
          ".validate":
            "newData.hasChildren(['hostName', 'scoreLimit', 'maxPlayers', 'createdAt']) && " +
            "newData.child('hostName').isString() && " +
            "newData.child('hostName').val().length <= 24 && " +
            "newData.child('maxPlayers').isNumber() && " +
            "newData.child('maxPlayers').val() >= 2 && " +
            "newData.child('maxPlayers').val() <= 8 && " +
            "newData.child('scoreLimit').isNumber() && " +
            // The deck follows from the ruleset, so it cannot change once a
            // card has been dealt. Absent means the original rules.
            "(!newData.child('ruleset').exists() || " +
            "newData.child('ruleset').val().matches(/^(classique|coupsbas)$/))",
        },

        seats: {
          ".read": "auth != null",
          // Seat 0 arrives with the race itself and is never rewritten.
          ...Object.fromEntries(
            SEATS.slice(1).map((n) => [
              String(n),
              {
                // Claim a free seat: only for yourself, only once, only while
                // the race has not started, and only if the seat before it is
                // taken — which keeps seats contiguous.
                ".write":
                  `auth != null && !data.exists() && ` +
                  `newData.child('uid').val() === auth.uid && ` +
                  `${game(`/seats/${n - 1}/uid`)}.exists() && ` +
                  `!${game("/start")}.exists() && ` +
                  `${n} < ${game("/lobby/maxPlayers")}.val()`,
                ".validate":
                  "newData.hasChildren(['uid', 'name']) && " +
                  "newData.child('name').isString() && " +
                  "newData.child('name').val().length <= 24",
              },
            ])
          ),
        },

        start: {
          ".read": "auth != null",
          // Written once, by anyone at the table, and never after a result.
          ".write":
            `auth != null && !data.exists() && newData.exists() && ` +
            `${isMember} && !${game("/result")}.exists()`,
          ".validate":
            "newData.hasChildren(['count', 'at']) && " +
            "newData.child('count').isNumber() && " +
            "newData.child('count').val() >= 2 && " +
            `newData.child('count').val() <= ${game("/lobby/maxPlayers")}.val() && ` +
            // The count must match the seats that are actually filled: the
            // last taking part is seated, the one after it is not.
            `${game("/seats/' + (newData.child('count').val() - 1) + '/uid")}.exists()`,
        },

        state: {
          // Only the actor moves the state on — or someone entering a forfeit
          // for a player who left or went missing.
          ".write":
            `auth != null && (${isActor} || (${isMember} && ` +
            `(${hasLeft(stateOf("actor"))} || ${isAbsent(stateOf("actor"))})))`,
          ".validate":
            "newData.hasChildren(['course', 'next', 'actor', 'phase', 'cursorRef', 'nextCourse']) && " +
            "newData.child('course').isString() && " +
            "newData.child('next').isString() && " +
            "newData.child('actor').isString() && " +
            "newData.child('actor').val().matches(/^[0-7]$/) && " +
            "newData.child('cursorRef').isString() && " +
            "newData.child('phase').val().matches(/^(draw|decide|targeting|picking|bounty|settling)$/) && " +
            // A seat that is not playing can never be handed the initiative.
            `(!${game("/start")}.exists() || ` +
            `newData.child('actor').val() < ${game("/start/count")}.val() + '')`,
        },

        presence: {
          $seat: {
            ".write": `auth != null && ${game("/seats/' + $seat + '/uid")}.val() === auth.uid`,
            ".validate": "newData.hasChildren(['online', 'lastSeen'])",
          },
        },

        leave: {
          $seat: {
            // Only ever about yourself, and only once.
            ".write":
              `auth != null && !data.exists() && ` +
              `${game("/seats/' + $seat + '/uid")}.val() === auth.uid`,
            ".validate": "newData.val() === true",
          },
        },

        forfeits: {
          $seat: {
            ".write": `auth != null && !data.exists() && ${isMember}`,
            ".validate": "newData.val() === true",
          },
        },

        nextReady: {
          // Cleared wholesale when the next course is dealt.
          ".write": `auth != null && !newData.exists() && ${isMember}`,
          $seat: {
            ".write": `auth != null && ${game("/seats/' + $seat + '/uid")}.val() === auth.uid`,
            ".validate": "newData.val() === true",
          },
        },

        result: {
          ".write": `auth != null && !data.exists() && ${isMember}`,
          ".validate":
            "newData.hasChildren(['winner', 'reason', 'by']) && " +
            "newData.child('winner').isNumber() && " +
            "newData.child('by').isString() && " +
            "newData.child('by').val().matches(/^[0-7]$/) && " +
            "newData.child('reason').val().matches(/^(score|abandon|claim)$/)",
        },

        rematch: {
          ".write": `auth != null && !data.exists() && ${isMember}`,
          ".validate":
            "newData.hasChildren(['code', 'by']) && " +
            "newData.child('code').isString() && " +
            "newData.child('code').val().matches(/^[A-Z0-9]{6}$/)",
        },

        courses: {
          $c: {
            deal: {
              // A course can only be dealt once, and only at the key the state
              // says comes next — which pins courses to their proper sequence.
              ".write":
                `auth != null && !data.exists() && ${isMember} && ` +
                `($c === 'c1' || $c === ${stateOf("nextCourse")})`,
            },
            peek: {
              $seat: {
                // Mark the one card you are about to take. Only your own
                // marker, and only while you are the one acting.
                ".write":
                  `auth != null && ` +
                  `${game("/seats/' + $seat + '/uid")}.val() === auth.uid && ` +
                  `$seat === ${stateOf("actor")}`,
                ".validate": "newData.isString() && newData.val().matches(/^d\\/[0-9]+$/)",
              },
            },
            actions: {
              $a: {
                ".write": actionWrite,
                ".validate": actionValidate,
              },
            },
          },
        },
      },
    },

    secrets: {
      $code: {
        // DELETION ONLY at this level, and never a blanket grant.
        //
        // Database rules cascade: a `.write` granted here would grant it on
        // every descendant, whatever their own rules say — which would defeat
        // the write-once rule below entirely. A seated player could then
        // rewrite a deck mid-course and publish values matching their new
        // deck, and the per-action `value === secret` check would pass
        // happily. A probe caught precisely that; keep this branch narrow.
        ".write": `auth != null && !newData.exists() && ${isMember} && ${isDisposable}`,
        $c: {
          // Write-once per course: a dealt deck can never be rewritten under
          // players who have already drawn from it. The second branch covers
          // the deal that arrives *with* a brand new race, when no seat exists
          // yet in the pre-write tree to prove membership.
          ".write":
            `auth != null && !data.exists() && ` +
            `(${isMember} || !${game("")}.exists())`,
          d: {
            $idx: {
              // The single most important rule in the file: a client may read
              // exactly one card, the one its own peek marker names, and only
              // while it is the actor for the current course.
              ".read":
                `auth != null && ` +
                `$c === ${stateOf("course")} && ` +
                `${isActor} && ` +
                `${game("/courses/' + $c + '/peek/' + " + stateOf("actor") + " + '")}.val() === 'd/' + $idx`,
              ".validate": "newData.isNumber()",
            },
          },
        },
      },
    },
  },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "..", "database.rules.json");
writeFileSync(target, JSON.stringify(rules, null, 2) + "\n");
console.log(`wrote database.rules.json (${JSON.stringify(rules).length} bytes)`);
