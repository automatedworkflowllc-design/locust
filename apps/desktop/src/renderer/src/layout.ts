/**
 * Which layout the shell draws: the full sidebar, or the compact avatar rail.
 *
 * This used to be a media query and nothing else, which meant the only way to
 * see the compact layout was to make the window small -- and the only way to
 * escape it was to make the window big. Colin, 2026-09-07: "can we have it be
 * an optional toggle as well?" Someone on a wide screen may want the rail
 * because they want the room for the conversation; someone on a small screen
 * may want the full sidebar and accept the squeeze.
 *
 * So width is now the DEFAULT rather than the rule. The preference decides,
 * and `auto` -- what everyone gets until they choose -- asks the width.
 *
 * Keeping the decision in one function rather than in CSS is what makes the
 * toggle possible at all: a media query cannot be overridden by a preference,
 * so the compact rules hang off a class this returns instead.
 */

export type LayoutPreference = 'auto' | 'compact' | 'wide'
export type LayoutMode = 'compact' | 'wide'

/**
 * The width at or below which `auto` chooses the rail.
 *
 * 1199 rather than 1119: the smallest window the app will open is 1120 wide
 * (`MIN_WINDOW_WIDTH`), and the old bound sat one pixel under it, so the
 * compact rules could never apply to any real window. The design pass asks
 * for the rail AT 1120x720, which is the size this now covers.
 */
export const COMPACT_MAX_WIDTH = 1199

/** Whether a stored value is a preference this build understands. */
export function isLayoutPreference(value: unknown): value is LayoutPreference {
  return value === 'auto' || value === 'compact' || value === 'wide'
}

/**
 * The layout to draw.
 *
 * A chosen preference wins at every width, deliberately: a person who picks
 * the full sidebar on a narrow window has decided they would rather scroll
 * than lose the list, and quietly overriding them at some threshold would be
 * the app arguing with a choice it offered.
 */
export function resolveLayout(preference: LayoutPreference, width: number): LayoutMode {
  if (preference === 'compact') return 'compact'
  if (preference === 'wide') return 'wide'
  return width <= COMPACT_MAX_WIDTH ? 'compact' : 'wide'
}
