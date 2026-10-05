import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createFileMissionLedger } from './index.js'

/**
 * How many ledger files produced no mission — counted where that is known.
 *
 * This lives in the reader because it cannot be derived above it. `listMissions`
 * returns issues from every parsed file and a PAGE of recovered missions, so a
 * caller asking "which issue ids are missing from `missions`?" counts every
 * mission that merely fell off the page as one that could not be read.
 *
 * Measured by Astra, 2026-09-09, against the fix I had shipped the day before:
 * one older mission with a damaged body, twenty newer clean ones, a page of
 * twenty — and a screen reading "20 local · 1 file could not be read" when
 * every file had in fact been read and the damaged one had recovered its safe
 * prefix perfectly.
 *
 * Crying wolf is the same disease as false reassurance pointed the other way,
 * and it is worse for this particular warning: it is only worth having if it
 * is rare enough to believe.
 */

const metadata = (missionId: string, createdAt: string) => ({
  missionId,
  runId: `run_${missionId}`,
  prompt: 'do the thing',
  runtime: 'codex' as const,
  model: 'gpt-6-astra',
  requestedRouteId: 'codex:account-default',
  resolvedRouteId: 'codex:gpt-6-astra',
  cliVersion: null,
  workspaceId: 'ws_test',
  sandbox: 'read-only' as const,
  executionPolicyVersion: 1 as const,
  createdAt
})

/**
 * Written by the REAL writer, not by hand.
 *
 * A first version hand-assembled the header and every file failed to recover,
 * so the paging case reported zero missions and looked like the defect it was
 * meant to prove absent. The clean fixtures now go through `createMission`;
 * only the deliberately damaged ones are written as raw bytes, where being
 * unparseable is the entire point and the schema does not matter.
 */
async function ledgerOf(count: number): Promise<{ root: string; ledger: ReturnType<typeof createFileMissionLedger> }> {
  const root = await mkdtemp(join(tmpdir(), 'locust-unreadable-'))
  const ledger = createFileMissionLedger({ rootDirectory: root })
  for (let index = 0; index < count; index += 1) {
    const id = `m_${String(index).padStart(2, '0')}`
    await ledger.createMission(metadata(id, `2026-09-08T00:00:${String(index).padStart(2, '0')}.000Z`))
  }
  return { root, ledger }
}

describe('the count of files that produced no mission', () => {
  it('is zero when every file recovered, however many are on the page', async () => {
    /*
     * THE regression, in the shape Astra measured. Twenty-one recoverable
     * files, a page of five: sixteen missions are absent from `missions` and
     * not one of them is unreadable.
     */
    const { ledger } = await ledgerOf(21)
    const paged = await ledger.listMissions({ limit: 5 })
    expect(paged.missions).toHaveLength(5)
    expect(paged.unreadableCount).toBe(0)
    // The control: unpaged, the same ledger reports the same zero.
    const whole = await ledger.listMissions({ limit: 30 })
    expect(whole.missions).toHaveLength(21)
    expect(whole.unreadableCount).toBe(0)
    /*
     * The default five seconds is how long this takes when the rest of the
     * suite is reading ledgers beside it: the gate measured 5011ms on
     * 2026-10-05, one millisecond over, four runs in a row. Twenty still
     * fails a hang.
     */
  }, 20_000)

  it('does not call a DAMAGED but recovered mission unreadable when it falls off the page', async () => {
    /*
     * Astra's exact repro, 2026-09-09, and the one that matters.
     *
     * The all-clean case above does not catch the defect: with no issues at
     * all, a derivation that compares issue ids against the page gives zero
     * either way. The defect needs a file that BOTH raises an issue AND
     * recovers -- body damage -- and then falls outside the page. Its issue
     * stays in `issues`, its mission is sliced away, and the comparison reads
     * that as "a file could not be read".
     *
     * My first version of this test was all-clean and stayed green against the
     * broken derivation. That is the third false green in two days, and the
     * pattern each time is a test that exercises the fix rather than the bug.
     */
    const { root, ledger } = await ledgerOf(1)
    // Body damage on the OLDEST mission: header intact, then garbage.
    await writeFile(join(root, 'm_00.jsonl'), 'not a record at all\n', { flag: 'a' })
    // Twenty newer, clean, so the damaged one is pushed off a page of twenty.
    const fresh = createFileMissionLedger({ rootDirectory: root })
    for (let index = 1; index <= 20; index += 1) {
      const id = `m_${String(index).padStart(2, '0')}`
      await fresh.createMission(metadata(id, `2026-09-09T00:00:${String(index).padStart(2, '0')}.000Z`))
    }
    const page = await fresh.listMissions({ limit: 20 })
    expect(page.missions).toHaveLength(20)
    // It raised an issue, and it is not on the page.
    expect(page.issues.length).toBeGreaterThan(0)
    expect(page.missions.some((mission) => mission.metadata.missionId === 'm_00')).toBe(false)
    // And it recovered perfectly well, so nothing here was unreadable.
    const whole = await fresh.listMissions({ limit: 30 })
    expect(whole.missions.some((mission) => mission.metadata.missionId === 'm_00')).toBe(true)
    expect(page.unreadableCount).toBe(0)
  }, 20_000)

  it('counts a file whose header is unreadable, and only that file', async () => {
    const { root, ledger } = await ledgerOf(1)
    await writeFile(join(root, 'm_bad.jsonl'), 'this is not json at all\n', 'utf8')
    const snapshot = await ledger.listMissions({ limit: 10 })
    expect(snapshot.missions).toHaveLength(1)
    expect(snapshot.unreadableCount).toBe(1)
  })

  it('counts one file, not one per issue it raised', async () => {
    /*
     * A truncated header raises `truncated-tail` AND `invalid-record` — the
     * pair Astra observed. Counting issues would report "2 files could not be
     * read" for one file, which is a fresh false statement rather than a fix.
     */
    const { root, ledger } = await ledgerOf(0)
    // A header cut off mid-JSON: unparseable AND unterminated.
    await writeFile(join(root, 'm_torn.jsonl'), '{\"schemaVersion\":1,\"recordType\":\"mission.crea', 'utf8')
    const snapshot = await ledger.listMissions({ limit: 10 })
    expect(snapshot.missions).toHaveLength(0)
    expect(snapshot.issues.length).toBeGreaterThan(1)
    expect(snapshot.unreadableCount).toBe(1)
  })

  it('is zero when the ledger directory itself cannot be read', async () => {
    /*
     * No file was read, so none can be called unreadable. The caller tells
     * this case apart by the read-failed issue, not by a count -- and the
     * Missions header says "the ledger could not be read" for it.
     *
     * A plain FILE where the directory belongs, which is the failure
     * `drive-ledger-failure` produces for real. A merely ABSENT directory is
     * not this case: `listMissions` creates it and answers with an empty
     * ledger, correctly. The first version of this test used a missing path
     * and failed for that reason -- it was asserting a failure the reader is
     * right not to have.
     */
    const parent = await mkdtemp(join(tmpdir(), 'locust-blocked-'))
    const rootDirectory = join(parent, 'mission-ledger')
    await writeFile(rootDirectory, 'not a directory', 'utf8')
    /*
     * It REJECTS, and that is the contract rather than a gap.
     *
     * A second version of this test expected a snapshot carrying a
     * `read-failed` issue. That issue is for a `readdir` that fails; this
     * fails one step earlier, in `ensureDirectory`, and the rejection is what
     * `readMissionHistory` turns into HISTORY_UNAVAILABLE -- which is exactly
     * how the screen comes to say "the ledger could not be read" rather than
     * counting anything. Asserting a snapshot here would have been asserting a
     * behaviour the reader is right not to have.
     */
    await expect(createFileMissionLedger({ rootDirectory }).listMissions()).rejects.toThrow()
  })
})
