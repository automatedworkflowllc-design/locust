// Colin: "a cloud send spends Colin's usage, so use fakes only".
// W6: "Run on your organization's environment (ID)"; "stored per folder".
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { choiceArgs, createClaudeCloud, windowsCommandLine } from './claude-cloud.js'
import type { PseudoTerminalRun } from './pseudo-terminal.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function world() {
  const root = await mkdtemp(join(tmpdir(), 'locust-cloud-environment-'))
  roots.push(root)
  const terminal = vi.fn(async (_run: PseudoTerminalRun) => ({ ok: true as const, drawn: 'View: https://claude.ai/code/session_0123456789' }))
  const run = vi.fn(() => { throw new Error('A window must not open') })
  const options = { storePath: join(root, 'sessions.json'), platform: 'win32' as const, terminal, run: run as never,
    discover: async () => [{ id: 'claude', executable: { discoveredPath: 'fake-claude', executablePath: 'fake-claude', prefixArgs: [] } }] as never }
  return { options, root, terminal, run, cloud: createClaudeCloud(options) }
}
it('A task carries an optional organization environment alongside the selected model and effort.', async () => {
  const choice = { model: 'haiku', effort: 'low', environment: 'ccpool_team-1' }
  expect(choiceArgs(choice)).toEqual(['--model', 'haiku', '--effort', 'low', '--environment', 'ccpool_team-1'])
  expect(choiceArgs(undefined)).toEqual([])
  expect(windowsCommandLine('fake', [], 'start', { choice })).toContain('--environment ccpool_team-1 --cloud')
  const w = await world()
  await w.cloud.start(w.root, 'Test', undefined, choice)
  expect(w.terminal.mock.calls[0]![0].line).toContain('--model haiku --effort low --environment ccpool_team-1 --cloud')
})
it.each(['', 'ccpool_', 'pool_team', 'ccpool_a & calc', 'ccpool_a;b', 'ccpool_a\nb', `ccpool_${'x'.repeat(81)}`])('An invalid environment id %j is refused before any launch.', async (environment) => {
  expect(() => choiceArgs({ environment })).toThrow(/environment ID/)
  const w = await world()
  expect((await w.cloud.start(w.root, 'Test', undefined, { environment })).ok).toBe(false)
  expect(w.terminal).not.toHaveBeenCalled()
  expect(w.run).not.toHaveBeenCalled()
  expect(await w.cloud.environment(w.root)).toBeUndefined()
})
it('A folder remembers its environment across reloads while other folders keep their own choices.', async () => {
  const w = await world()
  await Promise.all([
    w.cloud.start('folder-one', 'Test', undefined, { environment: 'ccpool_one' }),
    w.cloud.start('folder-two', 'Test', undefined, { environment: 'ccpool_two' })
  ])
  const reloaded = createClaudeCloud(w.options)
  expect(await reloaded.environment('folder-one')).toBe('ccpool_one')
  expect(await reloaded.environment('folder-two')).toBe('ccpool_two')
  expect(await reloaded.environment('other-folder')).toBeUndefined()
  await reloaded.start('folder-one', 'Test')
  expect(await reloaded.environment('folder-one')).toBeUndefined()
  expect(await reloaded.environment('folder-two')).toBe('ccpool_two')
})
it('A task without an environment keeps the default cloud arguments and opens no window.', async () => {
  const w = await world()
  expect((await w.cloud.start(w.root, 'Test')).ok).toBe(true)
  expect(w.run).not.toHaveBeenCalled()
  expect(w.terminal.mock.calls[0]![0].line).not.toContain('--environment')
  expect(windowsCommandLine('fake', [], 'start')).not.toContain('--environment')
})
it('An invalid saved environment is ignored instead of becoming a command argument.', async () => {
  const w = await world()
  await writeFile(`${w.options.storePath}.environments.json`, JSON.stringify([{ folder: w.root, id: 'ccpool_a & calc' }]))
  expect(await w.cloud.environment(w.root)).toBeUndefined()
})
