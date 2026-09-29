import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { MissionLedgerMetadata } from '@teammate/mission-store'

import { importSession, listImportableSessions } from './session-import.js'
import { createTerminalImports } from './terminal-catch-up.js'

/**
 * A CONVERSATION CAN BE IMPORTED FROM CLAUDE CODE OR CODEX (Colin, 2026-09-29).
 * The fixtures are the shapes of the real files (field names measured on this
 * machine); their words are made up.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})
const lines = (...records: object[]): string => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
const NOW = new Date('2026-09-29T20:00:00.000Z')

async function places(): Promise<{ readonly claudeHome: string; readonly codexHome: string; readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'locust-import-'))
  roots.push(root)
  return { claudeHome: join(root, '.claude'), codexHome: join(root, '.codex'), root }
}

async function write(path: string, text: string, at: Date): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text, 'utf8')
  await utimes(path, at, at)
}

const claudePerson = (id: string, cwd: string): string => lines(
  { type: 'user', entrypoint: 'cli', sessionId: id, cwd, timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'Plan the sales dashboard' } },
  { type: 'assistant', sessionId: id, cwd, timestamp: '2026-09-28T10:00:05.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here is the plan.' }] } },
  { type: 'user', entrypoint: 'cli', sessionId: id, cwd, timestamp: '2026-09-28T10:01:00.000Z', message: { role: 'user', content: 'Now add a chart' } },
  { type: 'assistant', sessionId: id, cwd, timestamp: '2026-09-28T10:01:02.000Z', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'chart.ts', content: 'x'.repeat(5000) } }] } },
  { type: 'user', sessionId: id, cwd, timestamp: '2026-09-28T10:01:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
  { type: 'assistant', sessionId: id, cwd, timestamp: '2026-09-28T10:01:09.000Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Chart added.' }] } },
  { type: 'ai-title', sessionId: id, aiTitle: 'Sales dashboard plan' }
)

describe('the sessions a person could import', () => {
  it("lists a person's Claude and Codex sessions, newest first, and none of Locust's, a subagent's or a script's", async () => {
    const at = await places()
    // Real folders: a session whose folder is gone is not offered.
    const shop = join(at.root, 'shop')
    const api = join(at.root, 'api')
    await mkdir(shop, { recursive: true })
    await mkdir(api, { recursive: true })
    const project = join(at.claudeHome, 'projects', 'C--work-shop')
    await write(join(project, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), claudePerson('aaaaaaaa-0000-4000-8000-000000000001', shop), new Date('2026-09-28T10:02:00.000Z'))
    // Locust's own run: print mode.
    await write(join(project, 'bbbbbbbb-0000-4000-8000-000000000002.jsonl'), lines({ type: 'user', entrypoint: 'sdk-cli', sessionId: 'bbbbbbbb-0000-4000-8000-000000000002', cwd: shop, timestamp: '2026-09-28T11:00:00.000Z', message: { content: 'Locust asked this' } }), new Date('2026-09-28T11:00:00.000Z'))
    // Older than the window.
    await write(join(project, 'cccccccc-0000-4000-8000-000000000003.jsonl'), claudePerson('cccccccc-0000-4000-8000-000000000003', shop), new Date('2026-08-01T10:00:00.000Z'))
    const day = join(at.codexHome, 'sessions', '2026', '09', '29')
    await write(join(day, 'rollout-2026-09-29T09-00-00-dddddddd-0000-4000-8000-000000000004.jsonl'), lines(
      { type: 'session_meta', timestamp: '2026-09-29T09:00:00.000Z', payload: { id: 'dddddddd-0000-4000-8000-000000000004', cwd: api, originator: 'codex_cli_rs', source: 'cli' } },
      { type: 'response_item', timestamp: '2026-09-29T09:00:01.000Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the login bug' }] } }
    ), new Date('2026-09-29T09:05:00.000Z'))
    await write(join(day, 'rollout-2026-09-29T10-00-00-eeeeeeee-0000-4000-8000-000000000005.jsonl'), lines(
      { type: 'session_meta', timestamp: '2026-09-29T10:00:00.000Z', payload: { id: 'eeeeeeee-0000-4000-8000-000000000005', cwd: api, originator: 'locust_desktop', source: 'exec' } }
    ), new Date('2026-09-29T10:05:00.000Z'))
    await write(join(at.codexHome, 'session_index.jsonl'), lines({ id: 'dddddddd-0000-4000-8000-000000000004', thread_name: 'Login bug', updated_at: '2026-09-29T09:05:00Z' }), NOW)

    const listed = await listImportableSessions(at, { now: NOW })
    expect(listed.map((session) => [session.runtime, session.title, session.cwd])).toEqual([
      ['codex', 'Login bug', api],
      ['claude', 'Sales dashboard plan', shop]
    ])
    // And one already in Locust is not offered again.
    expect(await listImportableSessions(at, { now: NOW, skip: new Set(['dddddddd-0000-4000-8000-000000000004']) })).toHaveLength(1)
  })
})

describe('importing a session', () => {
  it('makes a conversation of its exchanges, each carrying the session, named by it, and will not do it twice', async () => {
    const at = await places()
    const sessionId = 'aaaaaaaa-0000-4000-8000-000000000001'
    const file = join(at.claudeHome, 'projects', 'C--work-shop', `${sessionId}.jsonl`)
    await write(file, claudePerson(sessionId, 'C:\\work\\shop'), NOW)
    const made: MissionLedgerMetadata[] = []
    const events = new Map<string, readonly unknown[]>()
    const named: [string, string][] = []
    const learned: [string, string][] = []
    const imports = createTerminalImports(join(at.root, 'terminal-imports.json'))
    let id = 0
    const facts = {
      ledger: {
        createMission: async (metadata: MissionLedgerMetadata) => { made.push(metadata) },
        appendEvents: async (missionId: string, list: readonly unknown[]) => { events.set(missionId, list) }
      } as never,
      imports,
      workspaceIdFor: (cwd: string) => `ws_${cwd.length}`,
      learnFolder: async (folderId: string, path: string) => { learned.push([folderId, path]) },
      nameConversation: async (missionId: string, title: string) => { named.push([missionId, title]) },
      pathOf: async () => file,
      createId: () => String((id += 1))
    }
    const session = { runtime: 'claude' as const, sessionId, cwd: 'C:\\work\\shop', title: 'Sales dashboard plan' }
    const result = await importSession(session, facts)
    expect(result).toMatchObject({ ok: true, turns: 2, skipped: 0 })
    expect(made.map((metadata) => metadata.prompt)).toEqual(['Plan the sales dashboard', 'Now add a chart'])
    expect(made[0]!.continuesFrom).toBeUndefined()
    expect(made[1]!.continuesFrom).toMatchObject({ missionId: made[0]!.missionId, runtimeThreadId: sessionId })
    expect(made.every((metadata) => metadata.workspaceId === 'ws_12' && metadata.runtime === 'claude')).toBe(true)
    // Only the words: the second answer is the one after the tool, never the tool's input.
    expect(JSON.stringify(events.get(made[1]!.missionId))).toContain('Chart added.')
    expect(JSON.stringify(events.get(made[1]!.missionId))).not.toContain('xxxxxxxxxx')
    expect(JSON.stringify(events.get(made[0]!.missionId))).toContain(`"runtimeThreadId":"${sessionId}"`)
    expect(named).toEqual([[made[0]!.missionId, 'Sales dashboard plan']])
    expect(learned).toEqual([['ws_12', 'C:\\work\\shop']])
    // Read through: the terminal catch-up takes it from here, and it is not imported twice.
    expect(await imports.read(sessionId)).toBe('2026-09-28T10:01:09.000Z')
    expect(await importSession(session, facts)).toEqual({ ok: false, message: 'That conversation is already in Locust.' })
  })
})
