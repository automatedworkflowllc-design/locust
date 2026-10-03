import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createClaudeCloud, readTeleport, readingWorktreeName, windowsCommandLine } from './claude-cloud.js'
import type { PseudoTerminalRun } from './pseudo-terminal.js'

/**
 * A CLOUD SESSION IS READ IN A WORKTREE OF ITS OWN (0.558).
 *
 * Colin, 2026-10-02: "why cant we make this work for the user? ... exhaust
 * all possibilities before simply giving up". Attaching to a cloud session
 * is refused for the account, but `claude --teleport <id> --worktree <name>`
 * fetches the session's whole conversation and checks its branch out beside
 * the folder, the folder untouched. Measured that night: the transcript is
 * saved under `projects/<the worktree's path, slugged>/`, and is read as an
 * imported session is. The change is the branch against the folder's commit,
 * shown, and brought in only on Apply; the worktree goes after Apply or Forget.
 *
 * Here the teleport is played by a terminal that does what Claude Code did:
 * it makes the worktree on its branch, commits the session's change there,
 * and writes the transcript. git is real.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const temp = async (label: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), `locust-cloud-read-${label}-`))
  roots.push(root)
  return root
}
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const claude = async () => [{
  id: 'claude',
  executable: { discoveredPath: 'C:\\npm\\claude.cmd', executablePath: 'C:\\npm\\claude.cmd', prefixArgs: [] as string[] }
}] as never
const slug = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '-')

/** A repository with one commit, and a store that already knows a session sent from it. */
async function world() {
  const repo = await temp('repo')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'core.autocrlf', 'false')
  await writeFile(join(repo, 'cart.js'), 'export const total = (items) => items.length\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  const home = await temp('home')
  const storePath = join(await temp('store'), 'claude-cloud.json')
  const id = 'cc_0123456789abcdef0123'
  await writeFile(storePath, JSON.stringify({ sessions: [{ id, startedAt: '2026-10-02T20:00:00.000Z', prompt: 'Fix the cart total', folder: repo, sessionId: 'session_01G8RT9yXr7dbhVM7EUzpvEa', url: 'https://claude.ai/code/session_01G8RT9yXr7dbhVM7EUzpvEa' }] }))
  return { repo, home, storePath, id, name: readingWorktreeName(id) }
}

const TRANSCRIPT = [
  { type: 'permission-mode', permissionMode: 'default', sessionId: 'local' },
  { type: 'user', entrypoint: 'cli', promptSource: 'sdk', remoteSourced: true, timestamp: '2026-10-02T20:00:01.000Z', message: { role: 'user', content: 'Fix the cart total' } },
  { type: 'assistant', entrypoint: 'cli', timestamp: '2026-10-02T20:00:09.000Z', message: { role: 'assistant', model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'never shown' }, { type: 'text', text: 'Fixed: **total** now sums prices.' }] } },
  { type: 'user', entrypoint: 'cli', isMeta: true, timestamp: '2026-10-02T20:01:00.000Z', message: { role: 'user', content: 'This session is being continued from another machine.' } }
].map((line) => JSON.stringify(line)).join('\n')

/** What Claude Code's teleport did, measured 10/02, played with real git. */
function teleporting(w: Awaited<ReturnType<typeof world>>, options: { readonly drawn?: string; readonly change?: boolean; readonly transcript?: boolean; readonly worktree?: boolean } = {}) {
  const runs: PseudoTerminalRun[] = []
  const terminal = async (run: PseudoTerminalRun) => {
    runs.push(run)
    const where = join(w.repo, '.claude', 'worktrees', w.name)
    if (options.worktree === false) return { ok: true as const, drawn: options.drawn ?? '' }
    git(w.repo, 'worktree', 'add', '-q', '-b', `worktree-${w.name}`, where)
    git(w.repo, 'worktree', 'lock', where)
    if (options.change !== false) {
      git(where, 'checkout', '-q', '-B', 'claude/fix-cart-total')
      await writeFile(join(where, 'cart.js'), 'export const total = (items) => items.reduce((sum, item) => sum + item.price, 0)\n')
      git(where, 'commit', '-q', '-am', 'Sum prices')
    }
    if (options.transcript !== false) {
      const dir = join(w.home, 'projects', slug(where))
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '26be863b-6ead-4c62-932c-07388873cd26.jsonl'), TRANSCRIPT)
    }
    return { ok: true as const, drawn: options.drawn ?? ' ✔ Validating session\r\n ✔ Fetching session logs\r\n ✔ Checking out branch\r\n● Session resumed\r\n❯ ' }
  }
  return { runs, terminal }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('reading a cloud session', () => {
  it('teleports into a worktree of its own, out of sight, and stops once Claude Code is up', async () => {
    const w = await world()
    const { runs, terminal } = teleporting(w)
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal, claudeHome: w.home })
    await cloud.check(w.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.line).toBe(`cmd.exe /d /c ""C:\\npm\\claude.cmd" --teleport session_01G8RT9yXr7dbhVM7EUzpvEa --worktree ${w.name}"`)
    expect(runs[0]!.cwd).toBe(w.repo)
    // Done when the transcript is written -- not at "Session resumed", which comes first (measured).
    expect(runs[0]!.stopWhenWritten).toBe(join(w.home, 'projects', slug(join(w.repo, '.claude', 'worktrees', w.name))))
    expect(runs[0]!.stopWhen).not.toMatch(/resumed|shortcuts/)
  })

  it('reads the conversation from the transcript Claude Code saved, replies as words, never thinking', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    if (!read.ok) throw new Error(read.message)
    expect(read.exchanges).toEqual([{ prompt: 'Fix the cart total', answer: 'Fixed: **total** now sums prices.', at: '2026-10-02T20:00:09.000Z', model: 'claude-haiku-4-5-20251001' }])
    expect(JSON.stringify(read)).not.toContain('never shown')
    expect(JSON.stringify(read)).not.toContain('another machine')
  })

  it('shows the session branch’s change against the folder, and leaves the folder alone until Apply', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    if (!read.ok) throw new Error(read.message)
    expect(read.diff).toContain('diff --git a/cart.js b/cart.js')
    expect(read.diff).toContain('+export const total = (items) => items.reduce(')
    expect(await readFile(join(w.repo, 'cart.js'), 'utf8')).toBe('export const total = (items) => items.length\n')
    expect(git(w.repo, 'status', '--porcelain', '--untracked-files=no')).toBe('')
  })

  it('Apply brings the change in uncommitted and removes the worktree and its branch', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    if (!read.ok) throw new Error(read.message)
    expect(await cloud.apply(w.id)).toEqual({ ok: true })
    expect(await readFile(join(w.repo, 'cart.js'), 'utf8')).toContain('items.reduce(')
    expect(git(w.repo, 'log', '--oneline')).toMatch(/^\w+ first\n$/)
    expect(await exists(join(w.repo, '.claude', 'worktrees', w.name))).toBe(false)
    expect(git(w.repo, 'branch', '--list', `worktree-${w.name}`)).toBe('')
    // The session's own branch is the person's to keep or not.
    expect(git(w.repo, 'branch', '--list', 'claude/fix-cart-total')).toContain('claude/fix-cart-total')
  })

  it('Apply that does not fit changes nothing and says why', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w).terminal, claudeHome: w.home })
    await cloud.check(w.id)
    await writeFile(join(w.repo, 'cart.js'), 'export const total = () => 0 // mine\n')
    const applied = await cloud.apply(w.id)
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.message).toMatch(/does not apply cleanly.*Nothing was changed\.$/)
    expect(await readFile(join(w.repo, 'cart.js'), 'utf8')).toBe('export const total = () => 0 // mine\n')
  })

  // Two whole reads, each a real git worktree made and removed: past vitest's
  // default 5 s on Windows when the full suite shares the disk (5.1 s in the
  // 0.563 gate, under one alone).
  it('checking again starts from a fresh worktree, not the last one', { timeout: 20_000 }, async () => {
    const w = await world()
    const { runs, terminal } = teleporting(w)
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal, claudeHome: w.home })
    expect((await cloud.check(w.id)).ok).toBe(true)
    // The teleport would refuse a worktree that is already there; Locust removes it first.
    expect((await cloud.check(w.id)).ok).toBe(true)
    expect(runs).toHaveLength(2)
  })

  it('Forget removes the worktree too', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w).terminal, claudeHome: w.home })
    await cloud.check(w.id)
    await cloud.forget(w.id)
    expect(await exists(join(w.repo, '.claude', 'worktrees', w.name))).toBe(false)
    expect(await cloud.list(w.repo)).toEqual([])
  })

  it('a session that pushed no branch is read, with no change and the reason', async () => {
    const w = await world()
    const drawn = '● Session resumed without branch: Failed to checkout branch \'claude/session-confirmation-hb9mlu\'\r\n ? for shortcuts'
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w, { drawn, change: false }).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    if (!read.ok) throw new Error(read.message)
    expect(read.exchanges).toHaveLength(1)
    expect(read.diff).toBeUndefined()
    expect(read.note).toMatch(/could not check out its branch/)
  })

  it('runs as the person’s own Claude Code, not as a child of one, so the transcript is saved', async () => {
    const w = await world()
    const { runs, terminal } = teleporting(w)
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    try {
      const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal, claudeHome: w.home })
      await cloud.check(w.id)
    } finally {
      delete process.env.CLAUDE_CODE_CHILD_SESSION
    }
    expect('CLAUDE_CODE_CHILD_SESSION' in runs[0]!.env).toBe(true)
    expect(runs[0]!.env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined()
  })

  it('brought in but no transcript saved (measured, 2 runs of 6): the change is shown, and why there are no words', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w, { transcript: false }).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    if (!read.ok) throw new Error(read.message)
    expect(read.exchanges).toEqual([])
    expect(read.diff).toContain('cart.js')
    expect(read.note).toMatch(/did not save its conversation this time\. Check again/)
  }, 15_000)

  it('not brought in at all: says what Claude Code said, and leaves no worktree behind', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w, { transcript: false, worktree: false, drawn: 'Error: Session not found\r\n' }).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    expect(read).toEqual({ ok: false, message: 'Claude Code did not bring the session in: Session not found' })
    expect(await exists(join(w.repo, '.claude', 'worktrees', w.name))).toBe(false)
  }, 15_000)

  it('the trust question is left to the person; nothing is answered', async () => {
    const w = await world()
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal: teleporting(w, { drawn: 'Quick safety check: Is this a project you created or one you trust?' }).terminal, claudeHome: w.home })
    const read = await cloud.check(w.id)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.message).toMatch(/asks whether you trust this folder/)
  })

  it('a folder that is not a git checkout is told so, and nothing runs', async () => {
    const w = await world()
    const plain = await temp('plain')
    await writeFile(w.storePath, JSON.stringify({ sessions: [{ id: w.id, startedAt: '2026-10-02T20:00:00.000Z', prompt: 'x', folder: plain, sessionId: 'session_01G8RT9yXr7dbhVM7EUzpvEa' }] }))
    const { runs, terminal } = teleporting(w)
    const cloud = createClaudeCloud({ discover: claude, storePath: w.storePath, platform: 'win32', terminal, claudeHome: w.home, git: async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }) })
    const read = await cloud.check(w.id)
    expect(read.ok).toBe(false)
    expect(runs).toHaveLength(0)
  })
})

describe('what a teleport drew', () => {
  it('knows the long-paths failure and offers the fix in words, never setting it', () => {
    expect(readTeleport('error: unable to create file x/y/z: Filename too long').problem).toBe('long-paths')
  })
  it('the worktree on the command line is only ever Locust’s own name', () => {
    expect(windowsCommandLine('C:\\c.cmd', [], 'read', { session: 'session_01G8RT9yXr7dbhVM7EUzpvEa', worktree: 'x & del *', stay: false })).toBe('/d /c ""C:\\c.cmd" --teleport session_01G8RT9yXr7dbhVM7EUzpvEa --worktree "')
    expect(readingWorktreeName('cc_0123456789abcdef0123')).toBe('locust-cloud-0123456789ab')
  })
})
