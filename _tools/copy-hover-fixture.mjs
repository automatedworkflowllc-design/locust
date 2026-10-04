// A finished two-turn conversation for the Copy assertion. No model runs.
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function seedCopyHoverConversation(workspace) {
  const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')
  const profilePath = await mkdtemp(join(tmpdir(), 'locust-copy-hover-'))
  const ledger = createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })
  const workspaceId = `ws_${createHash('sha256').update(workspace).digest('hex').slice(0, 32)}`
  const ids = ['mission_copy_hover_first', 'mission_copy_hover_second']
  for (let i = 0; i < ids.length; i += 1) {
    const missionId = ids[i]
    const runId = `run_copy_hover_${i}`
    const at = `2026-10-03T10:0${i}:00.000Z`
    await ledger.createMission({ missionId, runId, prompt: i === 0 ? 'Copy hover fixture' : 'Which file did you read?', runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: null, workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at,
      ...(i === 0 ? {} : { continuesFrom: { missionId: ids[0], checkpointEpoch: 1, reason: 'follow-up' } }) })
    const event = (sequence, type, payload) => ({ id: `event_copy_${i}_${sequence}`, missionId, runId, sequence, occurredAt: at, sourceAdapter: 'opencode', type, payload: { ...payload, evidence: { redacted: true } } })
    await ledger.appendEvents(missionId, [
      event(1, 'message.delta', { itemId: 'answer', operation: 'append', text: i === 0 ? 'The kiln fires on Thursdays. DONE.' : 'note.txt', final: true }),
      event(2, 'run.completed', { process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 2, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: at, finishedAt: at } })
    ])
  }
  await ledger.flush()
  return { profilePath }
}
