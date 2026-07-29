// Vibration feedback. Optional, silent where unsupported (iOS Safari has no
// Vibration API), and switched off from the settings screen.

let enabled = true;

export const setHapticsEnabled = (value: boolean): void => {
  enabled = value;
};

export type HapticPattern = "tap" | "safe" | "cramp" | "whistle" | "win";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 10,
  safe: 16,
  cramp: [40, 60, 90],
  whistle: [20, 40, 20],
  win: [30, 50, 30, 50, 60],
};

export const vibrate = (pattern: HapticPattern): void => {
  if (!enabled) return;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* some browsers throw when the page is not visible */
  }
};
