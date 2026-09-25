import { describe, expect, it, vi } from 'vitest'

import { createCodexMissionService } from './codex-mission.js'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'
import type {
  RuntimeDiscovery,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRunner
} from '@teammate/runtime-adapters'

/**
 * THE NEXT TURN IS NOT REFUSED WHILE THE LAST ONE WINDS DOWN.
 *
 * drive-long-conversation on the packaged 0.297 (2026-09-23): turn 5 was
 * queued behind turn 4, turn 4 ended, and turn 5 never ran -- the window
 * sat on the teammate's home screen and the next message started a second
 * conversation. A run's terminal events reach the window before the host
 * lets go of it (the disk observation and the share come after), a queued
 * message goes the moment the window sees the end, and the host refused it
 * as "already has a mission running". The queue had nothing left to wait
 * behind, so the message was dropped.
 *
 * These hold the host's look at the disk open, which is that window, and
 * start the next turn inside it.
 */

const NOW = '2026-09-23T15:00:00.000Z'
const WORKSPACE = process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace'

const codex: RuntimeDiscovery = {
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
  version: { raw: 'codex-cli 0.151.0', version: '0.151.0', major: 0, minor: 151, patch: 0, prerelease: undefined },
  supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
  requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
  diagnostics: []
} as unknown as RuntimeDiscovery

const completion: RuntimeProcessCompletion = {
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
  oversizedRecordsDropped: 0,
  startedAt: NOW,
  finishedAt: NOW
}

function records(values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) yield { sequence: index + 1, raw: JSON.stringify(value) }
    },
    drainAvailable: () => []
  }
}

const TURN = [
  { type: 'thread.started', thread_id: 'thread-live' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'FOUR' } },
  { type: 'turn.completed', usage: { output_tokens: 2 } }
]

function harness() {
  // The host's look at the disk after a run: held open until released.
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let looks = 0
  const observeDisk = vi.fn(async () => {
    looks += 1
    if (looks === 2) await held
    return new Map<string, string>()
  })
  const scheduled: Array<() => void> = []
  let nextId = 0
  const ledger = {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => {
      throw new Error('not used here')
    },
    appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined,
    deleteMission: async () => true,
    listTrashedMissions: async () => [],
    restoreMission: async () => true,
    emptyTrash: async () => 0,
    storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
    pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
    // The turn that just ended, as the ledger holds it.
    getMission: async (missionId: string) =>
      ({
        metadata: { missionId, runId: 'run_1', prompt: 'Create four.txt', runtime: 'codex', model: 'account-default' },
        events: [{ type: 'run.started', payload: { runtimeThreadId: 'thread-live' } }]
      }) as unknown as RecoveredMission,
    listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
    flush: async () => undefined
  } as unknown as MissionLedger
  const runner = {
    start: () => ({ records: records(TURN), completion: Promise.resolve(completion) })
  } as unknown as RuntimeProcessRunner
  const service = createCodexMissionService({
    workspacePath: WORKSPACE,
    discover: async () => [codex],
    runner,
    ledger,
    createId: () => String(++nextId),
    now: () => new Date(NOW),
    schedule: (task) => scheduled.push(task),
    observeDisk
  })
  return { service, scheduled, release }
}

/** Run one turn to its end as the window sees it: its terminal event has arrived. */
async function endedTurn(h: ReturnType<typeof harness>): Promise<string> {
  const updates: CodexMissionUpdate[] = []
  const started = await h.service.start('Create four.txt', 'codex', 'accept-edits', {}, (update) => updates.push(update))
  if (!started.ok) throw new Error('the first turn did not start')
  h.scheduled[0]?.()
  await vi.waitFor(() => {
    expect(updates.some((update) => update.kind === 'event' && update.event.type === 'run.completed')).toBe(true)
  })
  return started.data.missionId
}

describe('a run that has ended but is still being wound down', () => {
  it('takes the next turn of that conversation', async () => {
    const h = harness()
    const missionId = await endedTurn(h)
    const next = await h.service.start('Create five.txt', 'codex', 'accept-edits', {}, () => undefined, undefined, undefined, missionId)
    h.release()
    expect(next.ok ? 'started' : next.error.code).toBe('started')
  })

  it('still refuses a second conversation for the same teammate until it has let go', async () => {
    const h = harness()
    await endedTurn(h)
    const other = await h.service.start('Something else entirely', 'codex', 'accept-edits', {}, () => undefined)
    h.release()
    expect(other.ok ? 'started' : other.error.code).toBe('RUN_ALREADY_ACTIVE')
  })
})
