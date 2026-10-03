// Colin: "use fakes only". W4: "Never two reads of one session at once".
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createClaudeCloud } from './claude-cloud.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
it('Overlapping reads share one teleport and the session lock is released afterward.', async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-cloud-lock-'))
  roots.push(root)
  const storePath = join(root, 'sessions.json')
  await writeFile(storePath, JSON.stringify({ sessions: [{ id: 'cc_abcdef', folder: root, prompt: 'Test', startedAt: new Date().toISOString(), sessionId: 'session_0123456789' }] }))
  let finish!: () => void
  const wait = new Promise<void>((resolve) => { finish = resolve })
  const terminal = vi.fn(async () => { await wait; return { ok: true as const, drawn: 'Quick safety check' } })
  const cloud = createClaudeCloud({ storePath, platform: 'win32', terminal,
    discover: async () => [{ id: 'claude', executable: { discoveredPath: 'fake', executablePath: 'fake', prefixArgs: [] } }] as never,
    git: async () => ({ code: 0, stdout: join(root, '.git'), stderr: '' }) })
  const first = cloud.check('cc_abcdef')
  await vi.waitFor(() => expect(terminal).toHaveBeenCalledTimes(1))
  const second = cloud.check('cc_abcdef')
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(terminal).toHaveBeenCalledTimes(1)
  finish()
  expect(await second).toEqual(await first)
  await cloud.check('cc_abcdef')
  expect(terminal).toHaveBeenCalledTimes(2)
})
