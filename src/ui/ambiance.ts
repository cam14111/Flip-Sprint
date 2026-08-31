// The colour the whole app is lit by.
//
// Coups bas is a nastier game than the original, and Nuit noire nastier still.
// The table says so before a card is dealt: same night track, lower and colder
// each time. The palettes themselves live in `src/index.css`; this only picks
// one and keeps the browser's own chrome in step with it.

import { useEffect } from "react";
import { RulesetId } from "@/game/types";

export type Ambiance = "classique" | "coupsbas" | "nuitnoire";

export const ambianceOf = (ruleset: RulesetId, brutal: boolean): Ambiance =>
  ruleset !== "coupsbas" ? "classique" : brutal ? "nuitnoire" : "coupsbas";

/**
 * Lights the app for the rules being played.
 *
 * The `theme-color` meta tag is read back from the stylesheet rather than
 * written from a second list of colours: it has to match what the app paints
 * at the top of the screen, and a hand-kept copy is exactly how that match was
 * lost once already — the gap shows on a real phone as a black band under the
 * notch, and never in a browser. One custom property, `--sky`, is the single
 * source; `npm run check:notch` measures the actual pixels for each ambiance.
 */
export const useAmbiance = (ruleset: RulesetId, brutal: boolean): void => {
  const ambiance = ambianceOf(ruleset, brutal);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ambiance = ambiance;

    const sky = getComputedStyle(root).getPropertyValue("--sky").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (sky && meta) meta.setAttribute("content", sky);
  }, [ambiance]);
};
