import { describe, expect, it, vi } from 'vitest'

import type {
  RuntimeDiscovery,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRun,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'
import type { MissionLedger, NormalizedRuntimeEvent } from '@teammate/mission-store'
import { createCodexMissionService } from './codex-mission.js'

/**
 * The 0.36.2 shared-folder mark fires on runs that were never concurrent.
 *
 * Found by the independent QA pass on 0.36.5 (2026-09-06), at a function
 * boundary against the real service.
 *
 * 0.36.2 marks two writing runs as sharing the folder when the second starts
 * while the first is still in `active`. But a FINISHED run stays in `active`
 * for a long time after its process has exited: through its own disk
 * observation, through its share to the workroom, and through the relay's
 * `onShared` -- which STARTS the recipient's run and is awaited before
 * `clearActive`. So the reply's run finds the sender sitting in `active` with
 * a `diskBefore`, both are marked as sharing the tree, and the reply's own
 * quiet edit is then counted against nobody:
 *
 *   "Another teammate was working in this folder at the same time, so what
 *    changed on disk cannot be told apart."
 *
 * About a run whose process had already exited before the reply began. Every
 * relay hop in a shared folder with an editing sender does this, and so does
 * any run a person starts in the seconds while a finished run's `git status`
 * is still being taken on a large repository.
 *
 * The sabotage check for these two is the third test: it is the identical
 * scenario with the ordering the code ASSUMES, and it stays green while the
 * two below go red on the ordering the code actually produces.
 */

const NOW = '2026-09-06T15:00:00.000Z'
const WORKSPACE = process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace'

function codexRuntime(): RuntimeDiscovery {
  return {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: 'codex',
      discoveredPath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      executablePath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: 'codex-cli 0.151.0', version: '0.151.0', major: 0, minor: 151, patch: 0 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    diagnostics: []
  } as unknown as RuntimeDiscovery
}

const completion = (): RuntimeProcessCompletion =>
  ({
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 4,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    startedAt: NOW,
    finishedAt: NOW
  }) as RuntimeProcessCompletion

function records(values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) yield { sequence: index + 1, raw: JSON.stringify(value) }
    },
    drainAvailable: () => []
  }
}

const fakeLedger = (overrides: Partial<MissionLedger> = {}): MissionLedger =>
  ({
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => { throw new Error('not used') },
    appendPeerLinks: async () => undefined,
    deleteMission: async () => true,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [] }),
    flush: async () => undefined,
    ...overrides
  }) as MissionLedger

/** A workroom that accepts a post, which is what makes `onShared` fire. */
const fakeWorkroom = () => {
  let nextId = 0
  return {
    post: async (input: { from: unknown; to: unknown; text: string }) => ({
      messageId: `wm_out_${String(++nextId)}`,
      sequence: nextId,
      from: input.from,
      to: input.to,
      text: input.text,
      postedAt: NOW
    }),
    unread: async () => ({ messages: [], remaining: 0 }),
    markDelivered: async () => undefined,
    read: async () => ({ messages: [], deliveries: [], issues: [] }),
    flush: async () => undefined
  } as unknown as Parameters<typeof createCodexMissionService>[0]['workroom']
}

const editingRun = (finalText?: string): RuntimeProcessRun => ({
  records: records([
    { type: 'thread.started', thread_id: 'thread-live' },
    { type: 'turn.started' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'cat README.md' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'cat README.md', exit_code: 0 } },
    ...(finalText === undefined
      ? []
      : [{ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: finalText } }]),
    { type: 'turn.completed', usage: { output_tokens: 2 } }
  ]),
  completion: Promise.resolve(completion())
})

// Each knows the other, or a share addressed to Gem reaches nobody and the
// relay never fires -- which the premise check below catches.
const WREN_SELF = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const GEM_SELF = { teammateId: 'tm_gem', name: 'Gem', role: 'Research & Briefs' }
const WREN = { self: WREN_SELF, others: [GEM_SELF] }
const GEM = { self: GEM_SELF, others: [WREN_SELF] }

/**
 * The folder gains a file on every look, so EVERY run's before-and-after
 * differ and every run therefore has something to attribute. The first
 * version of this only changed after the second look, which left the relayed
 * reply with an identical pair -- nothing to report either way -- and the
 * test passed while the defect it was written for was fully present.
 *
 * Two runs interleave their snapshots in an order that depends on timing, so
 * this cannot assume a fixed sequence; growing on every call is true for any
 * of them.
 */
const snapshots = () => {
  let looks = 0
  return vi.fn(async () => {
    looks += 1
    const map = new Map<string, string>()
    for (let file = 1; file <= looks; file += 1) map.set(`src/file-${String(file)}.ts`, ' M')
    return map
  })
}

const sharedNotices = (events: readonly NormalizedRuntimeEvent[]): readonly NormalizedRuntimeEvent[] =>
  events.filter(
    (event) =>
      event.type === 'adapter.diagnostic'
      && (event.payload as { code?: string }).code === 'host.shared_workspace'
  )

describe('a run that is over is not a run you are sharing the folder with', () => {
  it('a relayed reply is not marked as sharing the folder with the sender whose run already ended', async () => {
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    // The sender ends its turn with a share addressed to Gem, which is what
    // the relay carries. Only the first run shares; the reply must not, or
    // this recurses.
    let runs = 0
    const start = vi.fn((): RuntimeProcessRun => {
      runs += 1
      return runs === 1
        ? editingRun('<locust-share to="Gem">Here is what I found.</locust-share>')
        : editingRun()
    }) satisfies RuntimeProcessRunner['start']
    const scheduled: Array<() => void> = []
    let nextId = 0

    // `onShared` is the relay: it starts the RECIPIENT's run, and the service
    // awaits it before clearing the sender from `active`. That await is the
    // whole finding.
    let service: ReturnType<typeof createCodexMissionService>
    const onShared = async (): Promise<void> => {
      await service.start('the reply', 'codex', 'accept-edits', {}, () => undefined, undefined, GEM)
    }

    service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger,
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      observeDisk: snapshots(),
      workroom: fakeWorkroom(),
      onShared
    })

    await service.start('do the work', 'codex', 'accept-edits', {}, () => undefined, undefined, WREN)
    while (scheduled.length > 0) scheduled.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 40))
    while (scheduled.length > 0) scheduled.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 40))

    // The premise. Without it, "no notice" is what a test where the relay
    // never fired also reports -- which is exactly how the first draft of
    // this test passed against the defect it was written for.
    expect(start).toHaveBeenCalledTimes(2)

    // The sender's process had already exited before the reply was started.
    // Neither run should be told the folder cannot be told apart.
    expect(sharedNotices(appended)).toHaveLength(0)
  })

  it('a run started while a finished run is still reading the disk does not lose its attribution', async () => {
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    const start = vi.fn((): RuntimeProcessRun => editingRun()) satisfies RuntimeProcessRunner['start']
    const scheduled: Array<() => void> = []
    let nextId = 0

    // A slow after-snapshot, which is what `git status` is on a large
    // repository -- and the window in which a person starts the next run.
    let looks = 0
    let second: Promise<unknown> | undefined
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger,
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      observeDisk: vi.fn(async () => {
        looks += 1
        // The FIRST run's after-snapshot: start the next run while it is
        // still being taken.
        if (looks === 2) {
          second = service.start('the next thing', 'codex', 'accept-edits', {}, () => undefined, undefined, GEM)
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        const map = new Map<string, string>()
        if (looks > 2) map.set('src/notes.ts', ' M')
        return map
      })
    })

    await service.start('do the work', 'codex', 'accept-edits', {}, () => undefined, undefined, WREN)
    while (scheduled.length > 0) scheduled.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await second
    while (scheduled.length > 0) scheduled.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(sharedNotices(appended)).toHaveLength(0)
  })

  it('two runs that really do overlap are still marked', async () => {
    // The control, and the sabotage check for both tests above: the same
    // shape with the ordering the code assumes -- two runs genuinely live at
    // once -- must still produce the notice, or "no notice" above is
    // satisfied by a service that never marks anything.
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = fakeLedger({ appendEvents: async (_id, events) => { appended.push(...events) } })
    const start = vi.fn((): RuntimeProcessRun => editingRun()) satisfies RuntimeProcessRunner['start']
    const scheduled: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: WORKSPACE,
      discover: async () => [codexRuntime()],
      runner: { start },
      ledger,
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      observeDisk: snapshots()
    })

    const first = await service.start('one', 'codex', 'accept-edits', {}, () => undefined, undefined, WREN)
    const secondStart = await service.start('two', 'codex', 'accept-edits', {}, () => undefined, undefined, GEM)
    expect([first.ok, secondStart.ok]).toEqual([true, true])
    while (scheduled.length > 0) scheduled.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(sharedNotices(appended).length).toBeGreaterThan(0)
  })
})
