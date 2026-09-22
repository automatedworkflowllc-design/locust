import { mkdtemp, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '../src/index.js'
import type { MissionLedgerMetadata } from '../src/index.js'

/**
 * THE STORAGE REPORT READS ONLY WHAT CHANGED.
 *
 * Settings asks for it every time it opens, and it parsed every ledger file
 * to find one date: MEASURED 2026-09-22 on a copy of Colin's ledger (138
 * missions, 47.8 MB), 516-563 ms each time. It now keeps each file's date by
 * the file's size and modified time and reads a file again only when either
 * moved.
 *
 * Proved by what it reports, not by counting calls: a file overwritten with
 * garbage of the SAME size, its modified time put back, still reports its
 * old date -- which it can only do if it did not read the file again.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const OLD = '2026-08-01T10:00:00.000Z'
const RECENT = '2026-09-20T10:00:00.000Z'

function metadata(missionId: string, createdAt: string): MissionLedgerMetadata {
  return {
    missionId,
    runId: `run_${missionId}`,
    prompt: 'Inspect the workspace without changing it.',
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0',
    workspaceId: 'ws_test',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt
  }
}

/*
 * Every file's modified time pinned to a whole second before anything reads
 * it. Putting a stamp back through a Date drops the sub-millisecond part the
 * file system kept (…726.74 came back …727 on the first run of this test), so
 * the only stamp that can be restored exactly is one set this way to begin
 * with.
 */
const STAMP = new Date('2026-09-21T00:00:00.000Z')

async function seeded(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-storage-'))
  roots.push(root)
  for (const [missionId, createdAt] of [['mission_old', OLD], ['mission_recent', RECENT]] as const) {
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(metadata(missionId, createdAt))
    await ledger.flush()
    await utimes(join(root, `${missionId}.jsonl`), STAMP, STAMP)
  }
  return root
}

/** Same bytes count, different bytes, the modified time put back. */
async function garbleKeepingStamp(path: string): Promise<void> {
  const before = await stat(path)
  const length = (await readFile(path)).length
  await writeFile(path, 'x'.repeat(length))
  await utimes(path, STAMP, STAMP)
  const after = await stat(path)
  expect(after.size).toBe(before.size)
  expect(after.mtimeMs).toBe(before.mtimeMs)
}

describe('the storage report', () => {
  it('does not read an unchanged file again', async () => {
    const root = await seeded()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const first = await ledger.storageReport()
    expect(first).toMatchObject({ missionCount: 2, unreadableCount: 0, oldestUpdatedAt: OLD })

    await garbleKeepingStamp(join(root, 'mission_old.jsonl'))
    const second = await ledger.storageReport()
    // Read again, the garbled file would be unreadable and the oldest date
    // would jump to the recent mission. Neither happened.
    expect(second).toMatchObject({ missionCount: 2, unreadableCount: 0, oldestUpdatedAt: OLD })
  })

  it('reads a file again when it changed, and forgets one that is gone', async () => {
    const root = await seeded()
    const ledger = createFileMissionLedger({ rootDirectory: root })
    expect((await ledger.storageReport()).oldestUpdatedAt).toBe(OLD)

    // A different size: this one must be read again, and now has no date.
    await writeFile(join(root, 'mission_old.jsonl'), 'not a ledger\n')
    const changed = await ledger.storageReport()
    expect(changed).toMatchObject({ missionCount: 2, unreadableCount: 1, oldestUpdatedAt: RECENT })

    await unlink(join(root, 'mission_old.jsonl'))
    const gone = await ledger.storageReport()
    expect(gone).toMatchObject({ missionCount: 1, unreadableCount: 0, oldestUpdatedAt: RECENT })
  })

  it('a fresh ledger object reads everything, so nothing stale outlives the app', async () => {
    const root = await seeded()
    await createFileMissionLedger({ rootDirectory: root }).storageReport()
    await garbleKeepingStamp(join(root, 'mission_old.jsonl'))
    const fresh = await createFileMissionLedger({ rootDirectory: root }).storageReport()
    expect(fresh).toMatchObject({ missionCount: 2, unreadableCount: 1, oldestUpdatedAt: RECENT })
  })
})
