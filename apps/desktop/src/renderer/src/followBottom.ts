/**
 * Following a reply down the thread, without lurching.
 *
 * Colin, 2026-09-11: "the way the text comes down from the clients is very
 * glitchy ... our app just seems very jumpy/twitchy."
 *
 * MEASURED before changing anything (`probe-reply-arrives-smoothly`, a real
 * 400-word reply on Claude Code): the thread moved on **26 of 1361 frames**.
 * 893px of travel, a median move of 26px, a biggest move of 221px -- a third
 * of a screen in one frame -- and **47% of the whole journey in five frames**.
 * That is not a reply coming down a page; it is a page snapping five times.
 *
 * The cause is not cadence and not reflow -- both of those were found and
 * fixed on 2026-09-10 (`streamFrames.ts`, `settledText.ts`) and both were
 * measured again here: the text itself arrives in batches because the runtime
 * emits it in batches, and nothing can change that. What can change is what
 * the SCROLL does about it. It assigned `scrollTop = scrollHeight`, so every
 * batch teleported the page by however tall that batch was.
 *
 * This eases instead: each frame the scroll closes a fraction of the distance
 * to the bottom, so a 221px batch becomes about a dozen frames of motion and
 * a 26px one is over almost at once. Nothing is delayed -- the text is on
 * screen the moment it arrives, the page just takes a few frames to walk to
 * it.
 */

/** How much of the remaining distance to close each frame. */
const EASE = 0.22

/**
 * Never crawl. Below this, the remaining distance is closed at once rather
 * than asymptotically: a geometric approach never actually arrives, and a
 * thread that sits two pixels short of the bottom is a thread that has
 * stopped following as far as `atBottom` is concerned.
 */
const SNAP_WITHIN = 8

/**
 * Never trudge. A very long batch -- a fold opening, a recovered turn --
 * would otherwise take a visible second to walk down; past this the page is
 * simply moved, because at that distance easing reads as lag rather than as
 * motion.
 */
const TOO_FAR = 1_200

/**
 * The next scroll position on the way to `target`.
 *
 * Pure, so the approach can be proven to converge without a renderer: the one
 * thing a scroll animation must never do is stop short or overshoot, and both
 * are one test each.
 */
export function nextScrollTop(current: number, target: number, reducedMotion = false): number {
  const distance = target - current
  if (distance <= 0) return target
  if (reducedMotion || distance <= SNAP_WITHIN || distance > TOO_FAR) return target
  const step = Math.max(1, Math.round(distance * EASE))
  return current + step
}

/**
 * Whether the thread is close enough to the bottom to count as following it.
 *
 * Deliberately generous, and the reason is this file: while the scroll is
 * easing it is BY DEFINITION not at the bottom, so a tight tolerance would
 * read its own animation as the person scrolling up and stop following on the
 * first frame of every batch.
 */
export const FOLLOW_TOLERANCE = 120
