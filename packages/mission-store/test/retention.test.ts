import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '../src/index.js'
import type { MissionLedgerMetadata } from '../src/index.js'

/**
 * Retention: deleting old missions in bulk.
 *
 * The load-bearing rule is not the date arithmetic, it is that a prune must
 * never leave a KEPT conversation missing its earlier turns. A reply is a new
 * mission that continues an older one, so an unguarded "delete everything
 * older than a month" would quietly gut a conversation you are still in.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-prune-'))
  roots.push(root)
  return root
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-02T12:00:00.000Z')
const at = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString()

function metadata(missionId: string, createdAt: string, continuesFrom?: string): MissionLedgerMetadata {
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
    createdAt,
    ...(continuesFrom === undefined
      ? {}
      : { continuesFrom: { missionId: continuesFrom, checkpointEpoch: 1, reason: 'follow-up' as const } })
  }
}

/** Seed missions as `[id, daysAgo, continuesFrom?]`. */
async function seed(root: string, missions: readonly (readonly [string, number, string?])[]): Promise<void> {
  for (const [missionId, daysAgo, continuesFrom] of missions) {
    const ledger = createFileMissionLedger({ rootDirectory: root })
    await ledger.createMission(metadata(missionId, at(daysAgo), continuesFrom))
    await ledger.flush()
  }
}

const remaining = async (root: string): Promise<readonly string[]> =>
  (await readdir(root)).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -6)).sort()

describe('pruning old missions', () => {
  it('deletes what is older than the cutoff and keeps what is not', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40], ['mission_recent', 2]])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual(['mission_old'])
    expect(await remaining(root)).toEqual(['mission_recent'])
  })

  it('keeps an old mission that a kept conversation continues from', async () => {
    const root = await temporaryRoot()
    // A conversation opened long ago whose latest turn is from yesterday.
    await seed(root, [['mission_first', 40], ['mission_reply', 1, 'mission_first']])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual([])
    expect(result.keptForContinuity).toEqual(['mission_first'])
    expect(await remaining(root)).toEqual(['mission_first', 'mission_reply'])
  })

  it('keeps the whole chain behind a kept mission, not just its parent', async () => {
    const root = await temporaryRoot()
    await seed(root, [
      ['mission_one', 60],
      ['mission_two', 50, 'mission_one'],
      ['mission_three', 45, 'mission_two'],
      ['mission_four', 1, 'mission_three']
    ])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual([])
    expect([...result.keptForContinuity].sort()).toEqual(['mission_one', 'mission_three', 'mission_two'])
    expect(await remaining(root)).toHaveLength(4)
  })

  it('deletes a whole conversation when every turn of it is old', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_first', 60], ['mission_reply', 55, 'mission_first'], ['mission_new', 1]])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect([...result.deleted].sort()).toEqual(['mission_first', 'mission_reply'])
    expect(result.keptForContinuity).toEqual([])
    expect(await remaining(root)).toEqual(['mission_new'])
  })

  it('previews exactly what it would delete, and deletes nothing', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40], ['mission_first', 40], ['mission_reply', 1, 'mission_first']])
    const ledger = createFileMissionLedger({ rootDirectory: root })

    const preview = await ledger.pruneMissions({ before: at(30), dryRun: true })
    expect(preview.deleted).toEqual(['mission_old'])
    expect(preview.keptForContinuity).toEqual(['mission_first'])
    expect(await remaining(root)).toHaveLength(3)

    // The same call without the flag does exactly what the preview said.
    const done = await ledger.pruneMissions({ before: at(30) })
    expect(done.deleted).toEqual(preview.deleted)
    expect(await remaining(root)).toEqual(['mission_first', 'mission_reply'])
  })

  it('never deletes a mission the caller says is running', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40], ['mission_running', 40]])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30), protectMissionIds: ['mission_running'] })

    expect(result.deleted).toEqual(['mission_old'])
    expect(result.keptAsRunning).toEqual(['mission_running'])
    expect(await remaining(root)).toEqual(['mission_running'])
  })

  it('protects the conversation behind a running mission too', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_first', 40], ['mission_running', 40, 'mission_first']])

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30), protectMissionIds: ['mission_running'] })

    expect(result.deleted).toEqual([])
    expect(await remaining(root)).toEqual(['mission_first', 'mission_running'])
  })

  it('leaves a file it cannot read alone rather than guessing its age', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40]])
    await writeFile(join(root, 'mission_broken.jsonl'), 'not json at all\n', 'utf8')

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual(['mission_old'])
    expect(await remaining(root)).toEqual(['mission_broken'])
  })

  it('protects an old parent named by a file the full reader refuses', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_first', 40]])
    // A reply whose file the strict reader will not accept -- a record after
    // the header that does not parse -- but whose FIRST line still says which
    // conversation it belongs to. Deleting its parent would gut a
    // conversation the user still has.
    // Written at a schema version this build does not know -- the shape a
    // ledger takes after the app is rolled back one release. The strict
    // reader refuses the whole file; its first line still names the
    // conversation it belongs to.
    const header = {
      schemaVersion: 8,
      recordType: 'mission.created',
      ledgerSequence: 1,
      occurredAt: at(1),
      metadata: metadata('mission_reply', at(1), 'mission_first')
    }
    await writeFile(join(root, 'mission_reply.jsonl'), `${JSON.stringify(header)}\n`, 'utf8')

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual([])
    expect(result.keptForContinuity).toEqual(['mission_first'])
    expect(await remaining(root)).toEqual(['mission_first', 'mission_reply'])
  })

  it('deletes nothing at all while any ledger cannot be read', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40]])
    // A directory wearing a mission's name. Listing skips it in silence; its
    // links are unknowable, and one of them could be the newest turn of
    // mission_old's own conversation.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'mission_locked.jsonl'))

    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30) })

    expect(result.deleted).toEqual([])
    expect(result.unreadable).toEqual(['mission_locked'])
    expect(await remaining(root)).toContain('mission_old')
  })

  it('deletes only the missions the confirmation named, whatever else has aged', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_shown', 40], ['mission_aged_since', 40]])

    // The preview showed one mission. Between then and the confirmation
    // another crossed the line -- or was always there and simply was not in
    // the plan. The confirmation deletes what it promised, and no more.
    const result = await createFileMissionLedger({ rootDirectory: root })
      .pruneMissions({ before: at(30), only: ['mission_shown'] })

    expect(result.deleted).toEqual(['mission_shown'])
    expect(await remaining(root)).toEqual(['mission_aged_since'])
  })

  it('reports a file it could not delete instead of losing the ones it did', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_one', 40], ['mission_two', 40], ['mission_three', 40]])
    // A lock on one file, which is what a virus scanner or a sync client does
    // in the middle of a bulk delete on Windows.
    const ledger = createFileMissionLedger({
      rootDirectory: root,
      removeFile: async (path) => {
        if (path.includes('mission_two')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        await rm(path)
      }
    })

    const result = await ledger.pruneMissions({ before: at(30) })

    // The ones that went are reported as gone -- the failure in the middle
    // must not turn an irreversible deletion into "nothing happened".
    expect([...result.deleted].sort()).toEqual(['mission_one', 'mission_three'])
    expect(result.failed).toEqual(['mission_two'])
    expect(await remaining(root)).toEqual(['mission_two'])
  })

  it('refuses a cutoff that is not a timestamp', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_old', 40]])

    await expect(createFileMissionLedger({ rootDirectory: root }).pruneMissions({ before: 'whenever' }))
      .rejects.toThrow()
    expect(await remaining(root)).toEqual(['mission_old'])
  })
})

describe('what the local history costs', () => {
  it('counts the missions and their bytes, and dates the oldest by the record a prune would judge', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_one', 40], ['mission_two', 1]])

    const report = await createFileMissionLedger({ rootDirectory: root }).storageReport()

    expect(report.missionCount).toBe(2)
    expect(report.unreadableCount).toBe(0)
    expect(report.byteTotal).toBeGreaterThan(0)
    // Both files were written moments ago, so a report dated by the file's
    // own timestamp would say the history began today. It began 40 days ago.
    expect(report.oldestUpdatedAt).toBe(at(40))
  })

  it('reports an empty history as empty rather than failing', async () => {
    const report = await createFileMissionLedger({ rootDirectory: await temporaryRoot() }).storageReport()
    expect(report).toEqual({ missionCount: 0, byteTotal: 0, unreadableCount: 0 })
  })

  it('counts a file it cannot read separately, instead of leaving it out of a date it is inside', async () => {
    const root = await temporaryRoot()
    await seed(root, [['mission_one', 40]])
    await writeFile(join(root, 'mission_broken.jsonl'), 'not json at all\n', 'utf8')

    const report = await createFileMissionLedger({ rootDirectory: root }).storageReport()

    // Both files are on disk, so both are counted and both bytes are real.
    // Only one has a date, and the report says so rather than implying the
    // other is simply older or newer.
    expect(report.missionCount).toBe(2)
    expect(report.unreadableCount).toBe(1)
    expect(report.oldestUpdatedAt).toBe(at(40))
  })
})
