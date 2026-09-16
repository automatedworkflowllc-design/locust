import { describe, expect, it } from 'vitest'

import { byLiveThenRecent, conversationRows, ownerOf, narrowingLine } from './conversationList.js'
import { railRows } from './railFlyout.js'
import type { SidebarMission } from './components/Sidebar.js'

/**
 * The sidebar lists conversations, newest first, with the teammate on the row.
 *
 * Until 0.139.0 they were nested under the teammate who owned them, so the
 * axis was **who ran it** and finding one meant remembering who you gave it
 * to. Measured on a light week — fourteen conversations, four teammates, two
 * rooms — at the default window, 268px column:
 *
 * | | nested | flat |
 * | --- | --- | --- |
 * | spent before the first conversation | 330px | **4px** |
 * | visible without scrolling | 7 of 14 | **14 of 14** |
 * | the title column | 128px | 148px |
 * | characters the DOM even held | 44, capped | the whole title |
 *
 * The title column is 148px rather than the 175px the design predicted,
 * because this row keeps the 32px the `⋯` menu needs — the reservation
 * `text-may-not-bleed.test.ts` exists to protect. Recorded as measured
 * rather than rounded up to the drawing.
 *
 * This half is the ordering, which is behaviour. The half that reads the
 * stylesheet and the components lives in `main/`, where node types are
 * configured -- the same split `a-keyboard-user-can-see-where-they-are`
 * already uses, and the reason is prosaic: the web tsconfig has no `node`
 * types, so a `node:fs` import here does not compile.
 */

const row = (over: Partial<SidebarMission> & { missionId: string }): SidebarMission =>
  ({ title: 't', phase: 'completed', integrityIssueCount: 0, ...over }) as SidebarMission

describe('the order the list claims', () => {
  it('puts the newest first', () => {
    const order = conversationRows([
      row({ missionId: 'old', lastAt: '2026-09-10T00:00:00.000Z' }),
      row({ missionId: 'new', lastAt: '2026-09-15T00:00:00.000Z' }),
      row({ missionId: 'mid', lastAt: '2026-09-12T00:00:00.000Z' })
    ]).map((entry) => entry.missionId)
    expect(order).toEqual(['new', 'mid', 'old'])
  })

  it('puts a live conversation above a newer finished one', () => {
    // It is the one changing while you look at it.
    const order = conversationRows([
      row({ missionId: 'newer', lastAt: '2026-09-15T12:00:00.000Z' }),
      row({ missionId: 'live', phase: 'running', lastAt: '2026-09-15T09:00:00.000Z' })
    ]).map((entry) => entry.missionId)
    expect(order).toEqual(['live', 'newer'])
  })

  it('sorts a row with no timestamp last, not first', () => {
    /*
     * An unknown age must not outrank a known recent one, which is what a
     * bare `0` would do if it were read as the epoch.
     *
     * THIS IS THE ONE THAT BIT. The app restores the newest conversation
     * into `runs` on launch, and a restored run has no `startedAtIso` --
     * only a started one does. So the most recent conversation arrived with
     * no timestamp and landed at the BOTTOM of a most-recent-first list,
     * with no age beside it: the single row the ordering exists to lift to
     * the top. Invisible while rows were grouped by teammate and no age was
     * drawn; obvious on the first drive of the flat list. The fix is in
     * App's row builder, which now falls back to the restored mission's
     * `lastUpdatedAt`; this holds the sort's half of it.
     */
    const order = conversationRows([
      row({ missionId: 'unknown' }),
      row({ missionId: 'known', lastAt: '2026-09-01T00:00:00.000Z' })
    ]).map((entry) => entry.missionId)
    expect(order).toEqual(['known', 'unknown'])
  })

  it('is the same order the rail flyout uses', () => {
    // The rail lists the same conversations in a narrower place, not
    // different ones. Two orderings meant to agree are two that will not.
    const rows = [
      row({ missionId: 'a', lastAt: '2026-09-11T00:00:00.000Z' }),
      row({ missionId: 'b', phase: 'running', lastAt: '2026-09-01T00:00:00.000Z' }),
      row({ missionId: 'c', lastAt: '2026-09-14T00:00:00.000Z' })
    ]
    expect(railRows(rows).shown.map((entry) => entry.missionId))
      .toEqual(conversationRows(rows).map((entry) => entry.missionId))
  })

  it('does not cap the list, because the sidebar is not a popover', () => {
    const many = Array.from({ length: 40 }, (_, index) => row({ missionId: `m${String(index)}` }))
    expect(conversationRows(many)).toHaveLength(40)
  })

  it('leaves the rows it was given alone', () => {
    const given = [row({ missionId: 'b' }), row({ missionId: 'a', lastAt: '2026-09-14T00:00:00.000Z' })]
    conversationRows(given)
    expect(given[0]?.missionId).toBe('b')
  })

  it('is antisymmetric, so the list does not reshuffle between renders', () => {
    const newer = row({ missionId: 'x', lastAt: '2026-09-14T00:00:00.000Z' })
    const older = row({ missionId: 'y', lastAt: '2026-09-10T00:00:00.000Z' })
    expect(byLiveThenRecent(newer, older)).toBeLessThan(0)
    expect(byLiveThenRecent(older, newer)).toBeGreaterThan(0)
    // Two rows the comparator cannot separate compare equal. Asserted as a
    // number rather than with `toBe(0)`, because the subtraction can yield
    // `-0` and `Object.is(-0, 0)` is false -- a true statement about
    // JavaScript and a false one about the ordering.
    expect(Math.abs(byLiveThenRecent(newer, newer))).toBe(0)
  })
})

describe('who a conversation belongs to', () => {
  it('asks the shell first and the host second', () => {
    /*
     * `ownerId` is what the shell knows about a run still starting, which
     * has no missionId to look up yet; `missionOwners` is the host's record.
     * Asking only one is how a conversation came to appear in two places
     * depending on which had answered first.
     */
    expect(ownerOf(row({ missionId: 'm', ownerId: 'tm_live' }), { m: 'tm_host' })).toBe('tm_live')
    expect(ownerOf(row({ missionId: 'm' }), { m: 'tm_host' })).toBe('tm_host')
    expect(ownerOf(row({ missionId: 'm' }), {})).toBeUndefined()
  })
})

describe('the sentence above a narrowed list', () => {
  it('counts against the face when a face is on, and against the folder when only search is', () => {
    // Grok, pass 5 on 0.154.0: Atlas's face plus "invoice" said `1 of 20`
    // over a list of one, when the pile the person stood in was Atlas's five.
    expect(narrowingLine({ faceName: 'Atlas', query: '', shown: 5, inFace: 5, all: 20 })).toBe('Atlas — 5 of 5')
    expect(narrowingLine({ faceName: 'Atlas', query: 'invoice', shown: 1, inFace: 5, all: 20 })).toBe('Atlas · "invoice" — 1 of 5')
    expect(narrowingLine({ faceName: undefined, query: 'invoice', shown: 3, inFace: 20, all: 20 })).toBe('"invoice" — 3 of 20')
    expect(narrowingLine({ faceName: undefined, query: '  ', shown: 20, inFace: 20, all: 20 })).toBeUndefined()
  })
})
