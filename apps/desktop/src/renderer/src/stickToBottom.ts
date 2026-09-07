/**
 * Keep a scrolling thread pinned to its newest line — unless the person is
 * reading something older.
 *
 * Colin, 2026-09-07: "make sure chat auto scrolls to the bottom as well, or
 * find a good behavior for it, i find myself scrolling down alot." Nothing
 * scrolled the thread at all: every token of a long answer pushed the newest
 * line further below the fold and the person chased it by hand.
 *
 * The naive fix -- scroll to the bottom whenever anything changes -- is worse
 * than doing nothing, because it takes the scrollbar away from the person at
 * the exact moment they are using it. Scrolling up to re-read a diff while a
 * run is still streaming would yank them back once per token.
 *
 * So the rule is the one every good chat surface uses, stated plainly:
 *
 *   Follow the bottom only while the person is ALREADY at the bottom.
 *   The moment they scroll away, stop. When they come back, resume.
 *
 * "At the bottom" is a near-miss rather than an exact figure: sub-pixel
 * heights, a fractional device pixel ratio and a wrapped last line all leave
 * `scrollTop + clientHeight` a hair short of `scrollHeight`, and an exact test
 * would decide the person had scrolled away when they had not moved at all.
 */

/** How close to the end still counts as being at the end. */
export const AT_BOTTOM_SLACK = 64

export interface ScrollBox {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

/** Whether this box is scrolled to its end, within the slack above. */
export function atBottom(box: ScrollBox, slack: number = AT_BOTTOM_SLACK): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= slack
}

/**
 * Whether the view should be pulled back to the bottom after this change.
 *
 * `following` is what the last scroll event decided. Kept as a separate
 * function from `atBottom` because the two answer different questions at
 * different moments: one reads the box now, the other remembers what the
 * person was doing before the content grew underneath them. Measuring
 * "am I at the bottom" AFTER new content arrives always answers no, which is
 * how this behaviour is usually got wrong.
 */
export function shouldFollow(following: boolean, contentGrew: boolean): boolean {
  return following && contentGrew
}
