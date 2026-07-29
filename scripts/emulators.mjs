// Boots the Firebase Auth + Realtime Database emulators, with the project's
// real security rules loaded. Used by the end-to-end suite, and handy on its
// own to check that a rules change even parses.
//
//   node scripts/emulators.mjs          # runs until interrupted
//
// Requires Java (the database emulator is a JVM process).

import { spawn } from "node:child_process";
import process from "node:process";

const HUB = "http://127.0.0.1:4400";

/**
 * firebase-tools routes even 127.0.0.1 through HTTPS_PROXY and ignores
 * NO_PROXY, which breaks pushing the rules to a local emulator. The emulators
 * need no outbound network at all, so the proxy is stripped from their env.
 */
export const emulatorEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|(HTTPS?|ALL)_PROXY)$/i.test(key)) delete env[key];
  }
  return env;
};

export const waitForHttp = async (url, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new Error(`timeout waiting for ${url}`);
};

/**
 * The hub answers well before the emulators behind it do — on a first run the
 * database emulator is still downloading its JVM jar. Wait for the ones we
 * actually need to be registered, not merely for the hub to exist.
 */
const waitForEmulators = async (names, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let seen = {};
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${HUB}/emulators`);
      seen = await response.json();
      if (names.every((name) => seen[name]?.port)) return seen;
    } catch {
      /* hub not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `timeout waiting for ${names.join(", ")} (saw: ${Object.keys(seen).join(", ") || "nothing"})`
  );
};

export const startEmulators = async ({ verbose = false } = {}) => {
  const child = spawn(
    "npx",
    [
      "firebase",
      "emulators:start",
      "--only",
      "auth,database",
      "--project",
      "flip-sprint-live",
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true, env: emulatorEnv() }
  );

  const log = [];
  const collect = (chunk) => {
    const text = String(chunk);
    log.push(text);
    if (verbose) process.stdout.write(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };

  try {
    // Generous: the very first run downloads the database emulator's jar.
    await waitForEmulators(["auth", "database"], 300_000);
  } catch (error) {
    stop();
    throw new Error(`emulators failed to start:\n${log.join("")}\n${error}`);
  }

  // A rules file that does not parse still lets the emulator boot — the error
  // only shows in the log. Surface it rather than failing mysteriously later.
  const output = log.join("");
  if (/Error|error parsing|invalid/i.test(output) && /rules/i.test(output)) {
    stop();
    throw new Error(`database rules rejected:\n${output}`);
  }

  return { stop, log: () => log.join("") };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { stop } = await startEmulators({ verbose: true });
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  console.log("emulators up — Ctrl-C to stop");
}
