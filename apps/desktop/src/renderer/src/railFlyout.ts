/**
 * What the rail's flyout lists for a teammate, and in what order.
 *
 * The compact layout is a 64px avatar rail. It draws no conversation rows,
 * because four pixels of a title is not a smaller list -- it is a decoration
 * that lies about being one. The design agent's answer (2026-09-08, `Locust
 * Rail Conversations.dc.html`): the avatar IS the teammate, hover opens their
 * conversations as a flyout drawn at full width one pixel outside the rail,
 * and click pins it so keyboard and touch reach it at all.
 *
 * This module is the part of that answer that can be tested without a DOM:
 * which rows, in which order, how many, and what the count says.
 */

import type { SidebarMission } from './components/Sidebar.js'

/**
 * How many rows the flyout draws before it says "and more".
 *
 * Six, from the design: "a panel that scrolls through everything is the full
 * sidebar again, in a popover." The last section points at the Missions
 * screen, which is where everything lives.
 */
export const RAIL_ROWS_SHOWN = 6

export interface RailRows {
  readonly shown: readonly SidebarMission[]
  /** `5`, or `6 of 9` when there is more than fits. */
  readonly countLabel: string
}

/**
 * The live conversation first, because it is the one changing; then the rest
 * newest-first. A row with no timestamp sorts last rather than first -- an
 * unknown age must not outrank a known recent one.
 */
export function railRows(missions: readonly SidebarMission[]): RailRows {
  const ordered = [...missions].sort((a, b) => {
    const liveA = a.phase === 'running' ? 1 : 0
    const liveB = b.phase === 'running' ? 1 : 0
    if (liveA !== liveB) return liveB - liveA
    const atA = a.lastAt === undefined ? 0 : Date.parse(a.lastAt)
    const atB = b.lastAt === undefined ? 0 : Date.parse(b.lastAt)
    return (Number.isNaN(atB) ? 0 : atB) - (Number.isNaN(atA) ? 0 : atA)
  })
  const shown = ordered.slice(0, RAIL_ROWS_SHOWN)
  return {
    shown,
    countLabel:
      ordered.length > RAIL_ROWS_SHOWN
        ? `${String(RAIL_ROWS_SHOWN)} of ${String(ordered.length)}`
        : String(ordered.length)
  }
}

/**
 * The count badge at the avatar's top-left: drawn only past one.
 *
 * "Suppressed at 1, because 1 is what a single click already gets you." The
 * badge exists to answer "is there anything behind this face" before anyone
 * hovers, and one conversation is not an anything.
 */
export function railCountBadge(count: number): string | undefined {
  return count > 1 ? String(count) : undefined
}

/**
 * `now`, `5m`, `2h`, `3d`, `2w` -- the age a 268px row has room for.
 *
 * `agoLabel` in `teammateWork.ts` says "4 minutes ago", which is right on a
 * card and too long beside a title, a turn count and a phase dot.
 */
export function shortAgo(iso: string | undefined, now: Date = new Date()): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const seconds = Math.max(0, Math.floor((now.getTime() - at) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))}m`
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3_600))}h`
  if (seconds < 604_800) return `${String(Math.floor(seconds / 86_400))}d`
  return `${String(Math.floor(seconds / 604_800))}w`
}

/** The empty line, in the design's words. */
export function railEmptyLine(name: string): string {
  return `Nothing yet — pick ${name} and write below.`
}
