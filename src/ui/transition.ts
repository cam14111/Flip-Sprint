import { GameState } from "@/game/types";

/**
 * A key that changes exactly when something new happens on the board.
 *
 * The engine empties `state.events` on every transition, so that array is
 * already "what just happened" — which makes it the natural trigger for a
 * shake, a flash or a timed announcement. Using the array itself as an effect
 * dependency is a trap, though: online, the state is rebuilt by replaying the
 * whole action log on every snapshot, so a presence heartbeat or a peek marker
 * yields an identical but freshly allocated events array. The effect re-runs,
 * its cleanup cancels the timer, and it arms a new one — an overlay keyed that
 * way never closes at all, for as long as the table keeps breathing.
 *
 * Comparing content instead of identity makes a re-derivation the no-op it
 * ought to be, while a genuinely repeated event (the same runner bursting you
 * twice) still fires, because the transitions in between change the key.
 */
export const transitionKey = (game: GameState): string =>
  JSON.stringify(game.events);
