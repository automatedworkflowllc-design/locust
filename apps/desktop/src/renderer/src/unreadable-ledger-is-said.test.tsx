import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { MissionsScreen } from './components/Screens.js'

/**
 * A ledger file too damaged to yield a mission must still be said.
 *
 * Astra, 2026-09-08, writing damaged JSONL by hand and rendering this very
 * component from the result. The reader itself came out clean: for all six
 * damage shapes it keeps exactly the safe prefix and reports the right issue
 * code, and a file damaged in its BODY recovers a mission that carries
 * `integrityIssueCount`, so the header correctly read "1 with an incomplete
 * receipt".
 *
 * The defect is one level up. A file damaged in its HEADER -- or one over
 * MAX_LEDGER_BYTES -- recovers NO mission, so nothing in the list could carry
 * its damage, and the header read **"0 local · ledger verified"** about a
 * ledger the reader had just refused. With a clean neighbour it read
 * "1 local, 0 in this folder · ledger verified", still with no warning.
 *
 * The worse the damage, the more confident the reassurance, and the person
 * most in need of a warning is the only one who never sees it.
 *
 * The count existed the whole time: `readMissionHistory` put it on the
 * response and it crossed the IPC boundary intact. App.tsx never read it.
 *
 * This test RENDERS the component rather than checking the two helpers.
 * A first version tested `ledgerDamageWords` and `unreadableFileCount` alone,
 * and stayed green when the header's own decision was reverted to the broken
 * one -- the helpers were right and unused. The composed string is the claim,
 * so the composed string is what is asserted.
 */

const mission = (missionId: string, integrityIssueCount: number): PublicRecoveredMission => ({
  missionId,
  runId: `run_${missionId}`,
  workspaceId: 'ws_here',
  prompt: 'do the thing',
  runtime: 'codex',
  model: 'account-default',
  requestedRouteId: 'codex:account-default',
  resolvedRouteId: 'codex:gpt-6-astra',
  cliVersion: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  lastUpdatedAt: '2026-09-08T00:00:01.000Z',
  phase: 'completed',
  events: [],
  eventCount: 0,
  eventsTruncated: false,
  integrityIssueCount,
  checkpoints: [],
  peerMessages: [],
  mode: 'ask'
} as unknown as PublicRecoveredMission)

const header = (
  missions: readonly PublicRecoveredMission[],
  unreadableLedgers: number,
  ledgerUnreadable = false,
  counts?: { readonly totalMissions: number; readonly listedMissions: number }
): string => {
  const html = renderToStaticMarkup(
    <MissionsScreen
      missions={missions}
      unreadableLedgers={unreadableLedgers}
      ledgerUnreadable={ledgerUnreadable}
      {...(counts ?? {})}
      workspaceId="ws_here"
      teammates={[]}
      missionOwners={{}}
      runningMissionIds={new Set()}
      titleOf={() => 'a mission'}
      onOpen={() => undefined}
    />
  )
  const found = /lc-screen__meta[^>]*>([^<]*)</.exec(html)
  return (found?.[1] ?? '').replace(/&middot;|&#xB7;/g, '·')
}

describe('what the Missions header says about a damaged ledger', () => {
  it('says verified only when there is genuinely nothing wrong', () => {
    // The control. A healthy list says nothing about its records (0.723: "all readable" on every healthy list
    // was noise), so the damaged headers below are the only ones that speak -- and the count is all this says.
    expect(header([mission('m_1', 0)], 0)).toBe('1 conversation')
  })

  it('never claims verification while a file could not be read', () => {
    /*
     * THE regression, and the exact case Astra rendered: one unreadable file,
     * no missions at all. It read "0 local · ledger verified".
     */
    const said = header([], 1)
    expect(said).not.toMatch(/verified/i)
    expect(said).toContain('1 file could not be read')
  })

  it('warns even when a clean mission sits beside the unreadable file', () => {
    // The other case from the report: a clean neighbour made the screen read
    // "1 local, 0 in this folder · ledger verified" -- the damage hidden
    // behind a mission that was fine.
    const said = header([mission('m_1', 0)], 1)
    expect(said).not.toMatch(/verified/i)
    expect(said).toContain('1 file could not be read')
  })

  it('keeps the two kinds of damage apart rather than summing them', () => {
    /*
     * A mission with an incomplete receipt is HERE and readable with a gap in
     * it; an unreadable file is not here at all. One number covering both
     * would replace a false reassurance with a false count.
     */
    const said = header([mission('m_1', 2), mission('m_2', 0)], 1)
    expect(said).toContain('1 with an incomplete receipt')
    expect(said).toContain('1 file could not be read')
    expect(said).not.toContain('2 with an incomplete receipt')
  })

  it('never claims verification when the ledger could not be read at all', () => {
    /*
     * The third case, and the most extreme: not a damaged file but a ledger
     * that would not open. Found by driving it -- `drive-ledger-failure`
     * replaces the ledger directory with a plain file, so every read and write
     * fails on a real syscall, `readMissionHistory` answers
     * HISTORY_UNAVAILABLE, and App used to return early on `!response.ok`.
     * History stayed empty, the damage count stayed zero, and the header read
     * "0 local · ledger verified" about a ledger it had never opened.
     *
     * An empty ledger is a fact. A ledger that would not open is the absence
     * of any facts, and the two must not read the same.
     */
    const said = header([], 0, true)
    expect(said).not.toMatch(/verified/i)
    expect(said).toContain('the records could not be read')
  })

  it('still counts body damage on its own, as it always did', () => {
    // Astra measured this half as already correct. It must stay correct.
    const said = header([mission('m_1', 1)], 0)
    expect(said).toContain('1 with an incomplete receipt')
    expect(said).not.toMatch(/could not be read/)
  })
})

/*
 * The other half of this fix -- `unreadableFileCount`, which decides the number
 * this component is handed -- is tested in
 * `src/main/unreadable-ledger-count.test.ts`, not here.
 *
 * Importing it from the renderer pulls the whole main tree into
 * `tsconfig.web.json`, which has no Node types, and the web typecheck fails on
 * `Buffer` and `node:fs` in files this test never runs. The suite stayed green
 * throughout, so only the typecheck caught it. That separation is the point of
 * having two configs.
 */

// QA-2026-09-29 round 2, R28: a count that is not the total says so.
describe('what the Missions header says about a list cut short', () => {
  it('names how many are listed of how many are kept', () => {
    expect(header([mission('a', 0)], 0, false, { totalMissions: 2_412, listedMissions: 2_000 })).toContain('only the newest 2,000 of 2,412 turns are listed')
  })

  it('says nothing of it when everything is listed', () => {
    expect(header([mission('a', 0)], 0)).not.toContain('newest')
  })
})
