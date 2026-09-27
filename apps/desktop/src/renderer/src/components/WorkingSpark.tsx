import type { ReactElement } from 'react'

/**
 * A CONVERSATION THAT IS WORKING, in the sidebar (0.392): Claude Code's own
 * spinner.
 *
 * Colin, 2026-09-27: "you got any better ideas for a 'working/busy' icon for
 * sidebar, i think the one i suggested is getting outdated" -- the dotted
 * outline that morphed circle, triangle, square at 20px (0.225-0.391). Six
 * options were drawn side by side in a copy of the sidebar, and this is the
 * one that shipped: the glyphs Claude Code's terminal spinner turns through,
 * · ✢ ✳ ✶ ✻ ✽ and back, in the live lime.
 *
 * Type, not dots: a ring of 18 dots in 20px can only be specks, where a glyph
 * stays crisp at the size a row can spare. It turns in place without
 * travelling, so three running rows read as three calm marks.
 *
 * Drawn entirely in CSS (`.lc-spark`): the frames are the pseudo-element's
 * `content`, stepped by a keyframe animation, so a list of running rows costs
 * no renders. `data-orb` stays the drives' word for "this row is working".
 */
export function WorkingSpark(): ReactElement {
  return <span className="lc-spark" aria-hidden="true" data-orb="spark" />
}
