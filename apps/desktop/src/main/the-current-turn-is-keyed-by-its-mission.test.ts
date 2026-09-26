import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Code review B4, renderer-thread (b): the window draws one Thread and swaps
 * what it shows, and the current turn's list was not keyed, so the activity
 * card's own state (open, toggled, "show all") carried from one conversation
 * into the next. The list is keyed by the turn's mission now.
 */
const THREAD = readFileSync(fileURLToPath(new URL('../renderer/src/components/Thread.tsx', import.meta.url)), 'utf8')

describe("the current turn's list", () => {
  it("is keyed by the turn's mission", () => {
    const current = THREAD.indexOf('items={items}')
    expect(current).toBeGreaterThan(0)
    const opening = THREAD.lastIndexOf('<ThreadItems', current)
    expect(THREAD.slice(opening, current)).toContain(
      "key={restoredMission?.missionId ?? events.find((event) => event.missionId !== undefined)?.missionId ?? 'starting'}"
    )
  }, 10_000)
})
