// Colin: "Record a few real Codex app-server sessions as fixtures ... an
// approval, a file change, a steer, and a limit if one can be met cheaply.
// Use gpt-6-luna at low effort, and replay them through the adapter in tests."
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { startCodexAppServerRun, asProcessNormalizer, type AppServerRunProcess } from '../src/codex-app-server-run.js'
import { createCodexAppServerCommand } from '../src/commands.js'
import { createAppServerEventNormalizer } from '../src/app-server-events.js'
import type { NormalizedRuntimeEvent } from '../src/codex-events.js'
import { fixtureScrubber, STEER_TEXT } from '../../../_tools/record-codex-app-server-fixtures.mjs'

type Row = { dir: 'in' | 'out'; message: Record<string, any> } | { dir: 'exit'; completion: { exitCode: number; cancelled: boolean } }
const read = (name: string): Row[] => readFileSync(new URL(`./fixtures/codex/${name}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
function recordedServer(rows: Row[]) {
  let cursor = 0
  let emit: ((line: string) => void) | undefined
  let exit: (() => void) | undefined
  let killed = false
  const writes: Record<string, any>[] = []
  const pump = () => {
    while (cursor < rows.length) {
      const row = rows[cursor]
      if (row.dir === 'out' || emit === undefined) return
      ++cursor
      if (row.dir === 'in') emit(JSON.stringify(row.message) + '\n')
      else { expect(row.completion).toEqual({ exitCode: 0, cancelled: false }); exit?.() }
    }
  }
  const process: AppServerRunProcess = {
    write(line) {
      for (const part of line.trim().split('\n')) {
        const message = JSON.parse(part)
        const next = rows[cursor]
        expect(next?.dir, `Unexpected outbound message at fixture row ${cursor}: ${part}`).toBe('out')
        if (next.dir !== 'out') throw new Error('No recorded request at this point')
        expect(message).toEqual(next.message)
        writes.push(message); ++cursor
      }
      queueMicrotask(pump)
    },
    onData(listener) { emit = listener },
    onExit(listener) { exit = listener },
    kill() { killed = true }
  }
  return { process, writes, get cursor() { return cursor }, get killed() { return killed } }
}
async function replay(name: string) {
  const rows = read(name)
  const server = recordedServer(rows)
  const request = (method: string) => rows.find((row) => row.dir === 'out' && row.message.method === method) as Extract<Row, { dir: 'in' | 'out' }>
  const thread = request('thread/start').message.params
  const prompt = request('turn/start').message.params.input[0].text
  const approvals: Record<string, any>[] = []
  const run = startCodexAppServerRun({
    spawn: () => server.process,
    command: createCodexAppServerCommand({ executablePath: '/fixture/codex', prefixArgs: [] }, { workspacePath: thread.cwd, sandbox: thread.sandbox }),
    prompt, sandbox: thread.sandbox, approvalPolicy: thread.approvalPolicy,
    model: 'gpt-6-luna', effort: 'low',
    onRequest: async (request) => { approvals.push(request); return { decision: 'decline' } }
  })
  const normalizer = asProcessNormalizer(createAppServerEventNormalizer({ runId: 'fixture', now: () => new Date('2026-10-03T00:00:00Z') }))
  const events: NormalizedRuntimeEvent[] = []
  let steered: boolean | undefined
  for await (const record of run.records) {
    const got = normalizer.accept(record)
    events.push(...got)
    if (name === 'steer' && steered === undefined && got.some((event) => event.type === 'tool.started' && event.payload.toolKind === 'commandExecution')) steered = await run.steer(STEER_TEXT)
  }
  const completion = await run.completion
  expect(completion).toMatchObject({ exitCode: 0, cancelled: false, outputLimitExceeded: false })
  expect(server.cursor).toBe(rows.length)
  expect(server.killed).toBe(true)
  expect(events.filter((event) => event.type === 'run.started')).toHaveLength(1)
  expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(1)
  expect(events.some((event) => event.type === 'run.failed')).toBe(false)
  expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1))
  expect(events.find((event) => event.type === 'run.completed')?.payload).toMatchObject({ usage: { inputTokens: expect.any(Number), outputTokens: expect.any(Number) } })
  return { events, approvals, steered, rows, writes: server.writes }
}
it('The recorded approval arrives with its command, is declined, and never becomes a successful tool receipt.', async () => {
  const { events, approvals, writes } = await replay('approval-declined')
  expect(approvals).toHaveLength(1)
  expect(approvals[0]).toMatchObject({ method: 'item/commandExecution/requestApproval', params: { command: expect.stringContaining('FIXTURE_APPROVAL') } })
  expect(writes.some((message) => message.result?.decision === 'decline')).toBe(true)
  expect(events.some((event) => event.type === 'tool.failed' && event.payload.status === 'declined')).toBe(true)
  expect(events.some((event) => event.type === 'tool.completed')).toBe(false)
  expect(events.findLast((event) => event.type === 'message.delta')?.payload).toMatchObject({ operation: 'replace', text: 'APPROVAL_DECLINED', final: true })
})
it('The recorded file change preserves the patch and produces one matched apply_patch receipt.', async () => {
  const { events, rows } = await replay('file-change')
  const changed = rows.find((row) => row.dir === 'in' && row.message.method === 'item/completed' && row.message.params?.item?.type === 'fileChange')
  expect(changed?.dir).toBe('in')
  if (changed?.dir === 'in') expect(changed.message.params.item.changes).toEqual([expect.objectContaining({ path: 'C:\\fixture\\codex\\notes.txt', diff: expect.stringContaining('+AFTER') })])
  const starts = events.filter((event) => event.type === 'tool.started' && event.payload.name === 'apply_patch')
  const ends = events.filter((event) => event.type === 'tool.completed' && event.payload.name === 'apply_patch')
  expect(starts).toHaveLength(1); expect(ends).toHaveLength(1)
  expect(ends[0].payload).toMatchObject({ itemId: starts[0].payload.itemId, status: 'completed', command: '1 file change(s)' })
  expect(events.findLast((event) => event.type === 'message.delta')?.payload).toMatchObject({ text: 'FILE_CHANGED', final: true })
})
it('The recorded steer targets the live turn, is accepted without interrupting it, and changes the final answer.', async () => {
  const { steered, events, writes } = await replay('steer')
  expect(steered).toBe(true)
  expect(writes.filter((message) => message.method === 'turn/steer')).toHaveLength(1)
  expect(writes.find((message) => message.method === 'turn/steer')?.params).toMatchObject({ threadId: 'fixture_id_1', expectedTurnId: 'fixture_id_2', input: [{ type: 'text', text: STEER_TEXT }] })
  expect(writes.some((message) => message.method === 'turn/interrupt')).toBe(false)
  expect(events.findLast((event) => event.type === 'message.delta')?.payload).toMatchObject({ text: 'STEER_ACCEPTED', final: true })
})
it('Scrubbing removes personal paths, account data and hidden reasoning while preserving public summaries and correlated ids.', () => {
  const scrub = fixtureScrubber('C:\\private\\scratch', 'C:\\Users\\private-person')
  const got = scrub({ method: 'item/completed', params: { threadId: 'secret-thread-id', item: { id: 'secret-item-id', type: 'reasoning', summary: ['Checking the fixture'], content: ['hidden reasoning'] }, cwd: 'C:\\private\\scratch', path: 'C:\\Users\\private-person\\.codex\\sessions\\rollout.jsonl', email: 'person@example.com', accessToken: 'secret-token', createdAt: 1791060942 } })
  expect(got.params).toEqual({ threadId: 'fixture_id_1', item: { id: 'fixture_id_2', type: 'reasoning', summary: ['Checking the fixture'], content: [] }, cwd: 'C:\\fixture\\codex', path: '/fixture/rollout.jsonl', createdAt: 0 })
  expect(scrub({ method: 'turn/started', params: { threadId: 'secret-thread-id' } }).params.threadId).toBe('fixture_id_1')
  expect(scrub({ method: 'item/reasoning/textDelta', params: { delta: 'hidden reasoning' } })).toBeUndefined()
  expect(scrub({ method: 'account/rateLimits/updated', params: { rateLimits: { planType: 'personal-plan' } } })).toBeUndefined()
})
it('Every stored fixture is scrubbed and carries the requested model and low effort, with no reroute or invented limit.', () => {
  for (const name of ['approval-declined', 'file-change', 'steer']) {
    const rows = read(name)
    const text = JSON.stringify(rows)
    expect(text).not.toMatch(/C:(?:\\\\|\/)Users(?:\\\\|\/)|encryptedContent|encrypted_content|accessToken|refreshToken|api[_-]?key|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|codex\/event\/|item\/reasoning\/textDelta/i)
    for (const row of rows) if (row.dir === 'in' || row.dir === 'out') {
      if (row.message.method === 'turn/start') expect(row.message.params).toMatchObject({ model: 'gpt-6-luna', effort: 'low' })
      expect(row.message.method).not.toBe('model/rerouted')
      if (row.message.params?.item?.type === 'reasoning') expect(row.message.params.item.content).toEqual([])
    }
  }
})
