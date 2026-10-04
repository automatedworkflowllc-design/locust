import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedgerMetadata, RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { missionRecordMarkdown, rawRecordJson, recordTurns } from './mission-export.js'

/**
 * A SAVED RECORD KEEPS KEYS OUT.
 *
 * "Save the record" writes command output, diffs, the words said with a
 * card's answer and an edit check's new lines verbatim, to be sent to
 * someone. The Markdown replaces what is shaped like a key and says how many
 * pieces it replaced; the raw JSON is the ledger as recorded and says so.
 * The keys below are made up in the right SHAPE -- none is real.
 */

const ANTHROPIC_KEY = 'sk-ant-abcdefghijklmnopqrst'
const GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrst'
const REMOVED = '[secret-shaped text removed]'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const ISO = (minute: number, second = 0): string => `2026-10-02T09:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`
const SAVED_AT = '2026-10-03T08:00:00.000Z'

const MISSION: MissionLedgerMetadata = {
  missionId: 'mission_keys', runId: 'run_keys', prompt: 'Rotate the deploy key and tell me what you ran.', runtime: 'codex', model: 'gpt-test',
  requestedRouteId: 'codex', resolvedRouteId: 'codex:default', cliVersion: '0.160.0', workspaceId: 'ws_test', sandbox: 'workspace-write',
  mode: 'approve-each', executionPolicyVersion: 1, createdAt: ISO(0)
} as MissionLedgerMetadata

const processEvidence = {
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 1, inputDeliveryFailed: false,
  outputLimitExceeded: false, oversizedRecordsDropped: 0, forcedTerminationAttempted: false, terminationUnconfirmed: false,
  startedAt: ISO(0), finishedAt: ISO(1)
}

let sequence = 0
function event(type: string, payload: Record<string, unknown>, second: number): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `run_keys:${String(sequence)}`, runId: 'run_keys', missionId: 'mission_keys', sequence, occurredAt: ISO(1, second),
    sourceAdapter: 'codex', type, payload
  } as unknown as NormalizedRuntimeEvent
}
const tool = (type: 'tool.started' | 'tool.completed', itemId: string, fields: Record<string, unknown>, second: number): NormalizedRuntimeEvent =>
  event(type, { itemId, toolKind: 'command_execution', name: 'shell', phase: type === 'tool.started' ? 'started' : 'completed', evidence: { redacted: true }, ...fields }, second)

/** One turn whose command printed `commandOutput` and whose one change carried `diff`. */
async function turnsHolding(commandOutput: string, diff: string): Promise<readonly RecoveredMission[]> {
  sequence = 0
  const root = await mkdtemp(join(tmpdir(), 'locust-keys-'))
  roots.push(root)
  const ledger = createFileMissionLedger({ rootDirectory: root, now: () => new Date(ISO(30)) })
  await ledger.createMission(MISSION)
  await ledger.appendEvents(MISSION.missionId, [
    event('run.started', { runtimeThreadId: 'thread_1', evidence: { redacted: true } }, 0),
    tool('tool.started', 'c1', { command: 'cat .env' }, 1),
    tool('tool.completed', 'c1', { command: 'cat .env', output: commandOutput, exitCode: 0, status: 'completed', durationMs: 10 }, 2),
    tool('tool.completed', 'c2', {
      toolKind: 'file_change', name: 'Edit', command: 'deploy.yml', status: 'completed', patch: { text: diff, added: 1, removed: 1, truncated: false }
    }, 3),
    event('run.completed', { runtimeThreadId: 'thread_1', process: processEvidence }, 50)
  ])
  await ledger.flush()
  return (await recordTurns((id) => ledger.getMission(id), MISSION.missionId)).missions
}

const record = (turns: readonly RecoveredMission[]): string =>
  missionRecordMarkdown({ missions: turns, teammate: 'Wren', folder: 'C:\\work\\locust', locustVersion: '0.590.0', savedAt: SAVED_AT })

const PLAIN_DIFF = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'
const DIFF_WITH_A_TOKEN = ['--- a/deploy.yml', '+++ b/deploy.yml', '@@ -1 +1 @@', '-token: old', `+token: ${GITHUB_TOKEN}`].join('\n')

describe('a saved record keeps keys out', () => {
  it('replaces a key in a command output and a token in a diff, and says how many', async () => {
    const markdown = record(await turnsHolding(`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}\nDONE`, DIFF_WITH_A_TOKEN))

    expect(markdown).not.toContain(ANTHROPIC_KEY)
    expect(markdown).not.toContain(GITHUB_TOKEN)
    expect(markdown.split(REMOVED)).toHaveLength(3)
    expect(markdown).toContain('- **Secret-shaped text:** 2 pieces replaced in this file. The raw record keeps the original.')
  })

  it('says one piece, not one pieces, when one was replaced', async () => {
    const markdown = record(await turnsHolding(`token ${ANTHROPIC_KEY}`, PLAIN_DIFF))
    expect(markdown).toContain('- **Secret-shaped text:** 1 piece replaced in this file. The raw record keeps the original.')
  })

  it('keeps the original in the raw record, and warns that it does', async () => {
    const turns = await turnsHolding(`ANTHROPIC_API_KEY=${ANTHROPIC_KEY}`, DIFF_WITH_A_TOKEN)
    const raw = rawRecordJson(turns, '0.590.0', SAVED_AT)

    expect(raw).toContain(ANTHROPIC_KEY)
    expect(raw).toContain(GITHUB_TOKEN)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(parsed)[0]).toBe('warning')
    expect(parsed.warning).toBe('This file is the ledger as recorded, including any secret-shaped text the Markdown replaced.')
  })

  it('says none found when there is nothing to remove', async () => {
    const markdown = record(await turnsHolding('Tests 12 passed', PLAIN_DIFF))

    expect(markdown).toContain('- **Secret-shaped text:** none found.')
    expect(markdown).not.toContain(REMOVED)
  })

  it('replaces a key in the words said with a card answer and in an edit check new lines', async () => {
    const [turn] = await turnsHolding('ok', PLAIN_DIFF)
    const withCardAndCheck = {
      ...turn!,
      schemaVersion: 20,
      approvals: [{ kind: 'command', asked: 'cat .env', askedAt: ISO(1), occurredAt: ISO(2), answer: 'denied', by: 'person', words: `use ${GITHUB_TOKEN} instead` }],
      editChecks: [{ command: 'npm test', outcome: 'failed', newLines: [`auth ${ANTHROPIC_KEY}`], unchanged: false, first: true, occurredAt: ISO(3) }]
    } as unknown as RecoveredMission
    const markdown = record([withCardAndCheck])

    expect(markdown).not.toContain(GITHUB_TOKEN)
    expect(markdown).not.toContain(ANTHROPIC_KEY)
    expect(markdown).toContain('- **Secret-shaped text:** 2 pieces replaced in this file.')
  })
})
