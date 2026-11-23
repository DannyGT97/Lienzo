/**
 * Long work that cannot leave the main thread (merging a page, packing files) still must not hold the window: it is cut into
 * small pieces and, between pieces, gives the browser a turn to draw and answer touches. A page that stands still for seconds
 * while saving is what a tablet showed with every format that did its work in one go.
 *
 * `const tick = createTick(); for (...) { piece(); await tick(); }`: `tick` costs nothing until `budgetMs` of work have passed
 * since the last turn given, then waits for the next task of the event loop.
 */

/** Longest the window may be left without a turn: under a few frames, so a drag or a tap still feels attended to. */
export const TURN_BUDGET_MS = 12;

export type Tick = () => Promise<void>;

/** A tick that never waits (tests, or work already done off the main thread). */
export const noTick: Tick = () => Promise.resolve();

let channel: MessageChannel | null = null;
const waiting: Array<() => void> = [];

/** The next task of the event loop. A message channel, not a timer: timers are held back to once a second in a hidden window. */
function nextTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((done) => setTimeout(done, 0));
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
  }
  return new Promise((done) => {
    waiting.push(done);
    channel!.port2.postMessage(0);
  });
}

export function createTick(budgetMs: number = TURN_BUDGET_MS, now: () => number = () => performance.now()): Tick {
  let since = now();
  return async () => {
    if (now() - since < budgetMs) return;
    await nextTask();
    since = now();
  };
}
