import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileMissionLedger } from '@teammate/mission-store'
import { createCodexEventNormalizer } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

/**
 * A B4 lead from the code review, settled: the ledger refuses a JSON key over
 * 512 characters, and the adapters' evidence kept keys of any length -- so a
 * tool whose input carried one long key made the write throw, and a run that
 * cannot write its receipts is stopped. A real Codex record, through the real
 * normalizer, into a real ledger.
 */
describe('a tool input with a very long key', () => {
  it('is recorded, not a reason to stop the run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-longkey-'))
    try {
      const ledger = createFileMissionLedger({ rootDirectory: root })
      const at = '2026-09-24T12:00:00.000Z'
      await ledger.createMission({
        missionId: 'mission_k', runId: 'run_k', prompt: 'p', runtime: 'codex', model: 'account-default',
        requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null,
        workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at
      })
      const codex = createCodexEventNormalizer({ runId: 'run_k', missionId: 'mission_k', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: '0.156.1', now: () => new Date(at) })
      const longKey = 'k'.repeat(600)
      const events = [
        ...codex.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 't' }) }),
        ...codex.accept({ sequence: 2, raw: JSON.stringify({ type: 'item.started', item: { id: 'mcp_1', type: 'mcp_tool_call', server: 'notes', tool: 'save', arguments: { [longKey]: 'v' }, status: 'in_progress' } }) })
      ]
      await expect(ledger.appendEvents('mission_k', events)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
