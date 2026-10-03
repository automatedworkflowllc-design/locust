// Colin: "use fakes only". W3: "sends confirmed by Claude Code's own JSON".
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createClaudeCloud } from './claude-cloud.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const sessionId = 'session_0123456789'
async function send(reply: { code: number; output: string; stdout?: string }, platform: 'win32' | 'darwin' = 'win32') {
  const root = await mkdtemp(join(tmpdir(), 'locust-cloud-json-'))
  roots.push(root)
  const storePath = join(root, 'sessions.json')
  await writeFile(storePath, JSON.stringify({ sessions: [{ id: 'cc_abcdef', folder: root, prompt: 'Test', startedAt: new Date().toISOString(), sessionId }] }))
  const calls: readonly string[][] = []
  const cloud = createClaudeCloud({ storePath, platform,
    discover: async () => [{ id: 'claude', executable: { discoveredPath: 'fake-claude', executablePath: 'fake-claude', prefixArgs: [] } }] as never,
    exec: async (_file, args) => { (calls as string[][]).push([...args]); return reply }
  })
  return { result: await cloud.send('cc_abcdef', 'More'), calls }
}

it.each(['win32', 'darwin'] as const)('A cloud send requests JSON and accepts the final success on %s.', async (platform) => {
  const { result, calls } = await send({ code: 0, output: `Notice\n{"ok":true,"session_id":"${sessionId}","url":"https://claude.ai/code/${sessionId}"}\n` }, platform)
  expect(result).toEqual({ ok: true })
  expect(calls[0]!.join(' ')).toContain('--output-format json')
})
it('A success receipt is trusted whatever form its session id takes, so a sent message is never offered again.', async () => {
  expect((await send({ code: 0, output: '{"ok":true,"session_id":"cse_other_form"}\n' })).result).toEqual({ ok: true })
  expect((await send({ code: 0, output: '{"ok":true}\n' })).result).toEqual({ ok: true })
})
it.each(['Session archived', 'Session not found'])('A failed JSON send displays %s verbatim.', async (error) => {
  expect((await send({ code: 1, output: JSON.stringify({ ok: false, session_id: sessionId, error }) })).result).toEqual({ ok: false, message: error })
})
it('A cloud send uses the last JSON answer and never accepts terminal success words.', async () => {
  expect((await send({ code: 0, output: `{"ok":true,"session_id":"${sessionId}"}\n{"ok":false,"session_id":"${sessionId}","error":"Archived"}\n` })).result).toEqual({ ok: false, message: 'Archived' })
  expect((await send({ code: 0, output: 'Sent to cloud session' })).result.ok).toBe(false)
  expect((await send({ code: 1, output: JSON.stringify({ ok: true, session_id: sessionId }) })).result.ok).toBe(false)
})
it('A send nobody confirmed is said to be unconfirmed, never "not sent", so it is not sent twice (0.568).', async () => {
  const unconfirmed = 'Locust could not confirm that Claude Code sent that. Look at the session on claude.ai before sending it again, so it does not arrive twice.'
  // No receipt, no error: Claude Code may have sent it.
  expect((await send({ code: 0, output: 'Sent to cloud session' })).result).toEqual({ ok: false, message: unconfirmed })
  // A success receipt on a failing exit, or only on stderr: contradictory, so unknown.
  expect((await send({ code: 1, output: JSON.stringify({ ok: true, session_id: sessionId }) })).result).toEqual({ ok: false, message: unconfirmed })
  expect((await send({ code: 0, output: JSON.stringify({ ok: true, session_id: sessionId }), stdout: '' })).result).toEqual({ ok: false, message: unconfirmed })
  // Killed with nothing said at all.
  expect((await send({ code: -1, output: '' })).result).toEqual({ ok: false, message: unconfirmed })
})
it('A configuration failure keeps the Error fallback and stderr cannot forge success.', async () => {
  expect((await send({ code: 1, output: 'Error: Sign in first\n', stdout: '' })).result).toEqual({ ok: false, message: 'Claude Code did not send that: Sign in first' })
  expect((await send({ code: 0, output: JSON.stringify({ ok: true, session_id: sessionId }), stdout: '' })).result.ok).toBe(false)
})
