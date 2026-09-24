import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileWorkroom } from '@teammate/mission-store'
import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type { RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRecordStream, RuntimeProcessRun } from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CodexMissionStartResponse } from '../shared/ipc.js'
import { createCodexMissionService } from './codex-mission.js'
import { createRelay } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A2.12: A RUN STARTED TO ANSWER A MESSAGE IS SHOWN THAT MESSAGE.
 *
 * The prompt quoted the five OLDEST waiting messages. Since 0.322 a message
 * that needs nothing back waits for the recipient's next run -- so five of
 * those from Wren, then a question, started Booty's run for the question with
 * a prompt holding only the five. And a long prompt shed its NEWEST message
 * first: the one the run was for.
 */
const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }
const bootyPeer: MissionPeerContext = { self: BOOTY, others: [WREN] }

let folder: string
let workroom: Workroom
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'locust-started-for-'))
  workroom = createFileWorkroom({ rootDirectory: folder })
})
afterEach(async () => {
  await workroom.flush()
  await rm(folder, { recursive: true, force: true })
})

const from = { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_wren' }
const to = { teammateId: 'tm_booty', name: 'Booty' }
async function waitingThenAQuestion(): Promise<string> {
  for (let index = 1; index <= 6; index += 1) {
    await workroom.post({ from, to, text: `Note ${String(index)}: the deploy finished. No further action is needed from you.` })
  }
  return (await workroom.post({ from, to, text: 'Booty, what does the lint step run?' })).messageId
}

describe('the waiting messages a run is shown', () => {
  it('are the oldest, after the ones it was started for', async () => {
    const question = await waitingThenAQuestion()
    const plain = await workroom.unread('tm_booty', 5)
    expect(plain.messages.map((message) => message.text.slice(0, 6))).toEqual(['Note 1', 'Note 2', 'Note 3', 'Note 4', 'Note 5'])
    const asked = await workroom.unread('tm_booty', 5, [question])
    expect(asked.messages[0]?.messageId).toBe(question)
    expect(asked.messages).toHaveLength(5)
    expect(asked.remaining).toBe(2)
  })

  it('reach the runtime: the relay names the message, and the run quotes it', async () => {
    const question = await waitingThenAQuestion()
    const runtime: RuntimeDiscovery = {
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
    }
    const completion: RuntimeProcessCompletion = {
      exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 1, cancelled: false,
      forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false,
      outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: '2026-09-24T18:00:00.000Z', finishedAt: '2026-09-24T18:00:01.000Z'
    }
    const stream: RuntimeProcessRecordStream = {
      async *[Symbol.asyncIterator]() {
        yield { sequence: 1, raw: JSON.stringify({ type: 'turn.completed' }) }
      },
      drainAvailable: () => []
    }
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({ records: stream, completion: Promise.resolve(completion) }))
    const ledger = {
      createMission: async () => undefined, appendEvents: async () => undefined, appendHostFailure: async () => undefined,
      createCheckpoint: async () => { throw new Error('not used') }, appendPeerLinks: async () => undefined,
      deleteMission: async () => true, listTrashedMissions: async () => [], restoreMission: async () => true, emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async () => undefined, listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }), flush: async () => undefined
    } as unknown as MissionLedger
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [runtime],
      runner: { start },
      ledger,
      workroom,
      createId: (() => { let next = 0; return () => String(++next) })(),
      now: () => new Date('2026-09-24T18:00:00.000Z'),
      schedule: () => undefined
    })
    // The relay starts Booty's run for the question, the way it does in the app.
    const relay = createRelay({
      enabled: async () => true,
      peerContextFor: async (id) => (id === 'tm_booty' ? bootyPeer : undefined),
      start: async (request): Promise<CodexMissionStartResponse> =>
        service.start(request.prompt, 'codex', request.mode, {}, () => undefined, undefined, request.peer, request.followUpOf, request.relay),
      assignOwner: async () => undefined,
      notify: () => undefined
    })
    const posted = await workroom.unread('tm_booty', 99)
    const theQuestion = posted.messages.find((message) => message.messageId === question)!
    await relay.onShared(
      { runId: 'run_wren', missionId: 'mission_wren', runtime: 'codex', sandbox: 'read-only', model: undefined, peer: { self: WREN, others: [BOOTY] }, relay: undefined },
      [theQuestion]
    )
    const sent = start.mock.calls[0]?.[1] as string | undefined
    expect(sent).toBeDefined()
    expect(sent).toContain('Booty, what does the lint step run?')
  })
})
