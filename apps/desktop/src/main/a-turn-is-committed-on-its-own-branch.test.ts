import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { branchTurnsOf, createWorktreeManager, statusEntriesOf } from './worktrees.js'

/**
 * A COMMIT PER TURN ON THE TEAMMATE'S OWN BRANCH, AND REVIEW CHANGES (0.439).
 *
 * Colin picked idea #2 of PRODUCT-SUGGESTIONS-2026-09-28 ("i love idea number
 * 2"): when a turn ends for a teammate with Own branch on, the host commits
 * what changed in its tree to `locust/<name>`, and Review changes shows the
 * branch against where it left the person's branch, whole or turn by turn.
 * Real git against real directories, as worktrees.test.ts does, because the
 * behaviour under test is git's.
 */
const CLEANUP = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const
const REAL_GIT_TIMEOUT_MS = 30_000
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, CLEANUP)))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-turns-'))
  roots.push(root)
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'person@locust.test'], root)
  await git(['config', 'user.name', 'The person'], root)
  await writeFile(join(root, 'cart.py'), 'def total(items):\n    return 0\n', 'utf8')
  await git(['add', '.'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  return root
}

const message = (subject: string) => ({
  subject,
  trailers: [['Locust-Mission', 'm_1'], ['Locust-Route', 'opencode / nemotron']] as const,
  author: { name: 'Wren', email: 'tm_wren@teammates.locust' }
})

describe('a turn is committed on its own branch', () => {
  it('commits nothing when the turn changed nothing', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    expect(await manager.checkpoint('tm_wren', message('Nothing'))).toEqual({ kind: 'clean' })
  })

  it('commits every change, new files too, as the teammate, past a hook that would refuse, and leaves the person\'s branch alone', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository()
    // The person's own pre-commit hook: a checkpoint is Locust's, not theirs.
    await writeFile(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', 'utf8')
    await chmod(join(root, '.git', 'hooks', 'pre-commit'), 0o755)
    const manager = createWorktreeManager({ workspacePath: root })
    const tree = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    const mainBefore = (await git(['rev-parse', 'main'], root)).trim()
    await writeFile(join(tree, 'cart.py'), 'def total(items):\n    return sum(items)\n', 'utf8')
    await writeFile(join(tree, 'cart_test.py'), 'assert True\n', 'utf8')

    const result = await manager.checkpoint('tm_wren', message('Fix the cart total'))
    expect(result.kind).toBe('committed')
    if (result.kind !== 'committed') return
    expect(result.branch).toBe('locust/wren')
    expect([...result.files].sort()).toEqual(['cart.py', 'cart_test.py'])
    const shown = await git(['log', '-1', '--format=%an <%ae>%n%B', result.sha], root)
    expect(shown).toContain('Wren <tm_wren@teammates.locust>')
    expect(shown).toContain('Fix the cart total')
    expect(shown).toContain('Locust-Mission: m_1')
    expect(shown).toContain('Locust-Route: opencode / nemotron')
    expect((await git(['status', '--porcelain'], tree)).trim()).toBe('')
    expect((await git(['rev-parse', 'main'], root)).trim()).toBe(mainBefore)
    expect(await readFile(join(root, 'cart.py'), 'utf8')).toBe('def total(items):\n    return 0\n')
  })

  it('refuses a teammate with no tree of its own', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    await expect(manager.checkpoint('tm_nobody', message('x'))).rejects.toThrow(/no own branch/)
  })
})

describe('Review changes', () => {
  it('shows the branch against where it left the person\'s branch, whole and turn by turn, oldest first', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository()
    const manager = createWorktreeManager({ workspacePath: root })
    const tree = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    await writeFile(join(tree, 'cart.py'), 'def total(items):\n    return sum(items)\n', 'utf8')
    await manager.checkpoint('tm_wren', message('Turn one'))
    await writeFile(join(tree, 'notes.md'), 'why\n', 'utf8')
    await manager.checkpoint('tm_wren', message('Turn two'))
    // The person moves on meanwhile; the review is still measured from where Wren started.
    await writeFile(join(root, 'README.md'), 'mine\n', 'utf8')
    await git(['add', '.'], root)
    await git(['commit', '-q', '-m', 'the person\'s own'], root)
    await writeFile(join(tree, 'scratch.txt'), 'not yet\n', 'utf8')

    const review = await manager.review('tm_wren')
    expect(review.branch).toBe('locust/wren')
    expect(review.against).toBe('main')
    expect(review.turns.map((turn) => turn.subject)).toEqual(['Turn one', 'Turn two'])
    expect(review.turns[1]!.files).toEqual(['notes.md'])
    expect(review.diff).toContain('+    return sum(items)')
    expect(review.diff).toContain('+++ b/notes.md')
    expect(review.diff).not.toContain('README.md')
    expect(review.uncommitted).toEqual(['scratch.txt'])

    const one = await manager.turnDiff('tm_wren', review.turns[0]!.sha)
    expect(one).toContain('cart.py')
    expect(one).not.toContain('notes.md')
    // Only the teammate's turns: not the commit it started from, not the person's.
    await expect(manager.turnDiff('tm_wren', review.base)).rejects.toThrow(/not a turn/)
    await expect(manager.turnDiff('tm_wren', (await git(['rev-parse', 'main'], root)).trim())).rejects.toThrow(/not a turn/)
    await expect(manager.turnDiff('tm_wren', 'HEAD~1')).rejects.toThrow(/not a turn/)
  })

  it('never runs a program the repository names to draw a diff', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const root = await repository()
    const marker = join(root, 'ran.txt')
    await git(['config', 'diff.external', `sh -c "echo ran > '${marker.replace(/\\/g, '/')}'"`], root)
    const manager = createWorktreeManager({ workspacePath: root })
    const tree = await manager.ensure({ teammateId: 'tm_wren', name: 'Wren' })
    await writeFile(join(tree, 'cart.py'), 'changed\n', 'utf8')
    await manager.checkpoint('tm_wren', message('Turn'))
    const review = await manager.review('tm_wren')
    expect(review.diff).toContain('+changed')
    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })
})

describe('the pure parts', () => {
  it('reads status -z, a rename\'s old name skipped', () => {
    expect(statusEntriesOf(' M cart.py\0?? new file.txt\0R  b.py\0a.py\0')).toEqual([
      { code: ' M', path: 'cart.py' },
      { code: '??', path: 'new file.txt' },
      { code: 'R ', path: 'b.py' }
    ])
  })

  it('reads the turns of a log', () => {
    const sha = 'a'.repeat(40)
    expect(branchTurnsOf(`\x1e${sha}\x1fTurn one\x1f2026-09-28T10:00:00Z\n\ncart.py\nnotes.md\n`)).toEqual([
      { sha, subject: 'Turn one', at: '2026-09-28T10:00:00Z', files: ['cart.py', 'notes.md'] }
    ])
  })
})
