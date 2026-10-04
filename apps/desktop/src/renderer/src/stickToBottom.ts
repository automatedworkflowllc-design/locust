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

/**
 * What a scroll the app did not make means.
 *
 * - `follow`: at the bottom -- follow from here.
 * - `leave`: the view went UP, away from the bottom -- stop, and offer the
 *   way back.
 * - `catch-up`: short of the bottom without having gone up, because the
 *   content grew under it -- walk down again.
 * - `stay`: short of the bottom, not going up, and nothing is being followed
 *   -- leave the view alone.
 *
 * Only going up leaves. MEASURED 2026-09-23 (Yurt's beta report, #3: "from
 * turn 5 of 8 onward the thread no longer sits at the bottom"), logging every
 * scroll event through three turns: the walk reached the bottom, the content
 * grew 136px, and a scroll event arrived with the scroll position UNCHANGED
 * and no input anywhere in the run. The hook measured "136px from the bottom",
 * read that as the person scrolling up, stopped following and put the jump
 * arrow up. Turning the browser's scroll anchoring off did not change it.
 *
 * Asking whether a PERSON caused the scroll was the first repair, and it was
 * wrong the other way: the drive's own jump to the top was walked straight
 * back down, and so would be a keyboard user tabbing to an older message, or
 * a find on the page. Every way of leaving the bottom -- wheel, drag, keys,
 * focus, a script -- moves the view up. Content arriving never does.
 */
export function scrollVerdict(input: {
  readonly atBottom: boolean
  readonly movedUp: boolean
  readonly following: boolean
}): 'follow' | 'leave' | 'catch-up' | 'stay' {
  if (input.atBottom) return 'follow'
  if (input.movedUp) return 'leave'
  return input.following ? 'catch-up' : 'stay'
}
