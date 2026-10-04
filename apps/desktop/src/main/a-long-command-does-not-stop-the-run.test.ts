import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileMissionLedger } from '@teammate/mission-store'
import { createClaudeEventNormalizer } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

/**
 * A LONG COMMAND DOES NOT STOP THE RUN (0.610).
 *
 * Fable 5.1, 2026-10-04, in the arena's second round: asked for a landing
 * page in one file, it wrote the page through a Bash heredoc -- one command
 * of 29,322 characters. Claude Code's adapter announced the call a second
 * time once its input was whole, with the command unbounded; the ledger
 * holds 16,384 characters per field, refused the event ("Mission event is not
 * readable by the ledger reader"), and Locust stopped the run after 178 s,
 * before the command ran. Every other adapter already bounded its commands.
 * The whole path is checked here, adapter into the real ledger, with a
 * command larger than Fable's.
 */
const NOW = '2026-10-05T09:00:00.000Z'
const MISSION = 'mission_50000000-0000-4000-8000-000000000001'
const RUN = 'run_500001'

describe('a Claude Code call with a very long command', () => {
  it('is recorded, cut to fit with both ends kept, and the run goes on', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-long-command-'))
    try {
      const ledger = createFileMissionLedger({ rootDirectory: root })
      await ledger.createMission({
        missionId: MISSION, runId: RUN, prompt: 'Make a landing page in one file.',
        runtime: 'claude', model: 'fable', requestedRouteId: 'claude', resolvedRouteId: 'claude-account:default', cliVersion: null,
        workspaceId: `ws_${'a'.repeat(32)}`, sandbox: 'workspace-write', executionPolicyVersion: 1, createdAt: NOW
      })
      const claude = createClaudeEventNormalizer({ runId: RUN, missionId: MISSION, cliVersion: '2.1.290', now: () => new Date(NOW) })
      const page = `<!doctype html>\n${'<p class="plan">Coffee, every week.</p>\n'.repeat(1200)}`
      const command = `cat > index.html <<'EOF'\n${page}EOF`
      // The control: the command really is past the ledger's limit.
      expect(command.length).toBeGreaterThan(16_384)
      let sequence = 0
      const record = (value: unknown) => ({ sequence: ++sequence, raw: JSON.stringify(value) })
      const events = [
        ...claude.accept(record({ type: 'system', subtype: 'init', session_id: 's1' })),
        ...claude.accept(record({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' } } })),
        ...claude.accept(record({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command, description: 'Write the landing page' } }] } })),
        ...claude.accept(record({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '' }] } }))
      ]
      const named = events.filter((event) => (event.type === 'tool.started' || event.type === 'tool.completed') && typeof (event.payload as { command?: unknown }).command === 'string')
      expect(named.length).toBeGreaterThan(0)
      for (const event of named) {
        const kept = (event.payload as { command: string }).command
        expect(kept.length).toBeLessThanOrEqual(16_384)
        // Both ends: what it ran, and how it ended.
        expect(kept.startsWith("cat > index.html <<'EOF'")).toBe(true)
        expect(kept.endsWith('EOF')).toBe(true)
      }
      await expect(ledger.appendEvents(MISSION, events)).resolves.toBeUndefined()
      const back = await ledger.getMission(MISSION)
      expect(back?.events.length).toBe(events.length)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
