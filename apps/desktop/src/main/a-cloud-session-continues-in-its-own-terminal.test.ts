// Colin: "or run any real `claude` command; ... use fakes only".
// W5: "Continue in terminal", in a fresh "locust-cloud-<id>-here" worktree.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createClaudeCloud } from './claude-cloud.js'
import { openInTerminal, terminalArgsFor } from './open-in-terminal.js'
import type { TerminalRequest } from './open-in-terminal.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const launch = { commandName: 'claude', discoveredPath: 'C:/fake/claude.exe', executablePath: 'C:/fake/claude.exe', prefixArgs: [], kind: 'native' } as const
const request: TerminalRequest = { runtime: 'claude', sessionId: 'session_0123456789', cwd: 'C:/work/copy', title: 'Locust', launch, cloudSession: true }
it('A cloud terminal teleports the validated id instead of resuming a local session.', () => {
  expect(terminalArgsFor(request)).toEqual(['--teleport', 'session_0123456789'])
})
it.each(['', '--cloud', 'a & calc', '%PATH%', 'a;b', 'a\nb'])('A cloud terminal refuses the invalid session id %j.', (sessionId) => {
  expect(terminalArgsFor({ ...request, sessionId })).toBeUndefined()
})
it.each([true, false])('A cloud terminal uses Windows Terminal when available (%s) and otherwise a console.', async (available) => {
  const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = []
  const spawn = ((file: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options })
    const child = Object.assign(new EventEmitter(), { unref: () => undefined })
    queueMicrotask(() => file === 'wt.exe' && !available ? child.emit('error', new Error('missing')) : child.emit('spawn'))
    return child
  }) as never
  expect((await openInTerminal(request, { platform: 'win32', spawn })).ok).toBe(true)
  if (available) expect(calls[0]!.args.slice(-3)).toEqual(['C:/fake/claude.exe', '--teleport', 'session_0123456789'])
  else expect(calls[1]).toMatchObject({ file: 'cmd.exe', args: ['/d /k ""C:/fake/claude.exe" --teleport session_0123456789"'], options: { cwd: 'C:/work/copy' } })
})
async function world(sessionId = 'session_0123456789', failWorktree = false, failTerminal = false) {
  const root = await mkdtemp(join(tmpdir(), 'locust-cloud-here-'))
  roots.push(root)
  const storePath = join(root, 'sessions.json')
  await writeFile(storePath, JSON.stringify({ sessions: [{ id: 'cc_abcdef', folder: root, prompt: 'Test', startedAt: new Date().toISOString(), sessionId }] }))
  const git = vi.fn(async (args: readonly string[]) => ({ code: failWorktree && args[0] === 'worktree' ? 1 : 0, stdout: join(root, '.git'), stderr: '' }))
  const openTerminal = vi.fn(async (_request: TerminalRequest) => failTerminal ? { ok: false as const, message: 'Not opened' } : { ok: true as const, where: 'Windows Terminal' as const })
  const cloud = createClaudeCloud({ storePath, platform: 'win32', git, openTerminal, discover: async () => [{ id: 'claude', executable: launch }] as never })
  return { root, git, openTerminal, result: await cloud.continueInTerminal('cc_abcdef') }
}
it('Continuing a cloud session creates a detached worktree without touching its folder or reading worktree.', async () => {
  const w = await world()
  const where = join(w.root, '.claude', 'worktrees', 'locust-cloud-abcdef-here')
  expect(w.git).toHaveBeenCalledWith(['worktree', 'add', '--detach', where, 'HEAD'], w.root)
  expect(w.openTerminal).toHaveBeenCalledWith({ ...request, title: 'Locust · Claude cloud', cwd: where })
  expect(w.result.ok).toBe(true)
})
it('An invalid stored cloud id creates no worktree and opens nothing.', async () => {
  const w = await world('a & calc')
  expect(w.result.ok).toBe(false)
  expect(w.git).not.toHaveBeenCalled()
  expect(w.openTerminal).not.toHaveBeenCalled()
})
it('A worktree creation failure opens no terminal and preserves any earlier copy.', async () => {
  const w = await world('session_0123456789', true)
  expect(w.result.ok).toBe(false)
  expect(w.openTerminal).not.toHaveBeenCalled()
  expect(w.git.mock.calls.some(([args]) => args.includes('remove'))).toBe(false)
})
it('A terminal launch failure removes only the newly created clean worktree without force.', async () => {
  const w = await world('session_0123456789', false, true)
  expect(w.result.ok).toBe(false)
  expect(w.git).toHaveBeenCalledWith(['worktree', 'remove', join(w.root, '.claude', 'worktrees', 'locust-cloud-abcdef-here')], w.root)
})
it('Real git makes a fresh terminal checkout while the original folder keeps its uncommitted work.', async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-cloud-here-git-'))
  roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  await writeFile(join(root, 'cart.txt'), 'committed')
  git('add', 'cart.txt')
  git('commit', '-qm', 'Fixture')
  await writeFile(join(root, 'cart.txt'), 'uncommitted')
  const storePath = join(root, 'sessions.json')
  await writeFile(storePath, JSON.stringify({ sessions: [{ id: 'cc_abcdef', folder: root, prompt: 'Test', startedAt: new Date().toISOString(), sessionId: 'session_0123456789' }] }))
  const openTerminal = vi.fn(async (_request: TerminalRequest) => ({ ok: true as const, where: 'Windows Terminal' as const }))
  const cloud = createClaudeCloud({ storePath, platform: 'win32', openTerminal, discover: async () => [{ id: 'claude', executable: launch }] as never })
  expect((await cloud.continueInTerminal('cc_abcdef')).ok).toBe(true)
  const where = openTerminal.mock.calls[0]![0].cwd
  expect(await readFile(join(where, 'cart.txt'), 'utf8')).toBe('committed')
  expect(await readFile(join(root, 'cart.txt'), 'utf8')).toBe('uncommitted')
  expect(git('worktree', 'list')).toContain('locust-cloud-abcdef-here')
})
