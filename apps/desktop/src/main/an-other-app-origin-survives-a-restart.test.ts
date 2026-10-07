import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileMissionLedger, type MissionLedgerMetadata } from '@teammate/mission-store'
import { readOneMission } from './mission-history.js'
import { LEFT_OUT, BACKED_UP_FILES } from './profile-backup.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
describe('an other-app origin survives a restart', () => {
  it('records schema 23, recovers the origin, and projects it into history without forgetting Ask mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-mcp-ledger-')); roots.push(directory)
    const metadata: MissionLedgerMetadata = { missionId: 'mission_1', runId: 'run_1', prompt: 'Review this', runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId: 'ws_test', sandbox: 'read-only', mode: 'ask', executionPolicyVersion: 1, createdAt: '2026-10-07T00:00:00Z', startedBy: { kind: 'mcp' } }
    const ledger = createFileMissionLedger({ rootDirectory: directory })
    await ledger.createMission(metadata); await ledger.flush()
    const fresh = createFileMissionLedger({ rootDirectory: directory })
    const answer = await readOneMission(fresh, undefined, 'mission_1')
    expect(answer.ok && answer.data.mission.startedBy).toEqual({ kind: 'mcp' })
    expect(answer.ok && answer.data.mission.mode).toBe('ask')
    const file = join(directory, 'mission_1.jsonl')
    const header = JSON.parse((await readFile(file, 'utf8')).split('\n')[0]!)
    expect(header.schemaVersion).toBe(23)
    header.schemaVersion = 22
    await writeFile(file, JSON.stringify(header) + '\n')
    const old = await createFileMissionLedger({ rootDirectory: directory }).getMission('mission_1')
    expect(old).toBeUndefined() // an older writer never claimed this new origin
  })
  it('makes the external origin visible in the thread and keeps the actual ask as a message', async () => {
    const thread = await readFile(fileURLToPath(new URL('../renderer/src/components/Thread.tsx', import.meta.url)), 'utf8')
    expect(thread).toContain('Started from another app · Ask mode (read only)')
    expect(thread).toContain("earlierTurns.some(turn => turn.startedBy?.kind === 'mcp')")
  })
  it('classifies the token file and opt-in as excluded from every profile backup', () => {
    expect(LEFT_OUT['locust-mcp-connection.json']).toContain('token')
    expect(LEFT_OUT['locust-mcp.json']).toContain('enable again')
    expect(BACKED_UP_FILES).not.toContain('locust-mcp-connection.json')
    expect(BACKED_UP_FILES).not.toContain('locust-mcp.json')
  })
})
