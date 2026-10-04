import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorktreeManager, gitVersionCanLand, landingDraft } from './worktrees.js'

/**
 * LAND IT (0.440): a teammate's own branch lands on the person's branch as
 * one commit of theirs.
 *
 * Idea #2 of PRODUCT-SUGGESTIONS-2026-09-28, which Colin picked; his bar,
 * 2026-09-28: "if we cant make it clean and seamless, we dont do it". So
 * every way a landing can go wrong is found BEFORE anything is touched, and
 * the one thing that can only fail during it -- the person's own commit
 * hook -- leaves their checkout exactly as it was. Real git, as
 * worktrees.test.ts, because the behaviour under test is git's.
 */
const CLEANUP = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const
const REAL_GIT_TIMEOUT_MS = 60_000
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, CLEANUP)))
})

const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
/** A checkout's text, line endings as written: git here may check files out with CRLF (core.autocrlf). */
const text = async (path: string): Promise<string> => (await readFile(path, 'utf8')).replace(/\r\n/g, '\n')

const WREN = { teammateId: 'tm_wren', name: 'Wren' }
const turn = (subject: string) => ({
  subject,
  trailers: [['Locust-Route', 'opencode / nemotron']] as const,
  author: { name: 'Wren', email: 'tm_wren@teammates.locust' }
})

/** A repository, Wren's tree on it, and her two turns: cart.py changed, notes.md added. */
async function twoTurns() {
  const root = await mkdtemp(join(tmpdir(), 'locust-land-'))
  roots.push(root)
  await git(['init', '-q', '-b', 'main'], root)
  await git(['config', 'user.email', 'person@locust.test'], root)
  await git(['config', 'user.name', 'The person'], root)
  await writeFile(join(root, 'cart.py'), 'def total(items):\n    return 0\n', 'utf8')
  await writeFile(join(root, 'README.md'), 'mine\n', 'utf8')
  await git(['add', '.'], root)
  await git(['commit', '-q', '-m', 'first'], root)
  const manager = createWorktreeManager({ workspacePath: root })
  const tree = await manager.ensure(WREN)
  await writeFile(join(tree, 'cart.py'), 'def total(items):\n    return sum(items)\n', 'utf8')
  await manager.checkpoint('tm_wren', turn('Fix the cart total'))
  await writeFile(join(tree, 'notes.md'), 'summed items\n', 'utf8')
  await manager.checkpoint('tm_wren', turn('Write down why'))
  return { root, tree, manager }
}

describe('a branch lands as one commit', () => {
  it('lands both turns as one commit of the person\'s, and the teammate\'s branch starts from it', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, manager } = await twoTurns()
    const preview = await manager.landPreview(WREN)
    expect(preview.block).toBeUndefined()
    expect(preview.onto).toBe('main')
    expect([...preview.files].sort()).toEqual(['cart.py', 'notes.md'])
    expect(preview.draft).toBe('Fix the cart total\n\n- Fix the cart total\n- Write down why\n\nLocust-Teammate: Wren\nLocust-Route: opencode / nemotron')

    const landed = await manager.land(WREN, preview.draft)
    expect(landed.kind).toBe('landed')
    if (landed.kind !== 'landed') return
    expect(landed.branchReset).toBe(true)
    // One commit on main, the person's own, with the files in their checkout.
    expect((await git(['rev-list', '--count', 'main'], root)).trim()).toBe('2')
    expect((await git(['log', '-1', '--format=%an|%s', 'main'], root)).trim()).toBe('The person|Fix the cart total')
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return sum(items)\n')
    expect(await text(join(root, 'notes.md'))).toBe('summed items\n')
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('')
    // Wren's next review is only what is new.
    expect((await manager.review('tm_wren')).turns).toEqual([])
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'nothing' })
  })

  it('refuses when the person has changed a file it would write, and touches nothing', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, manager } = await twoTurns()
    await writeFile(join(root, 'cart.py'), 'def total(items):\n    return 42  # mine, unsaved\n', 'utf8')
    const head = (await git(['rev-parse', 'HEAD'], root)).trim()
    const landed = await manager.land(WREN, '')
    expect(landed).toEqual({ kind: 'blocked', block: { kind: 'your-changes', files: ['cart.py'] } })
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return 42  # mine, unsaved\n')
    expect((await git(['rev-parse', 'HEAD'], root)).trim()).toBe(head)
  })

  it('lands around the person\'s unsaved edits to other files, and keeps them', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, manager } = await twoTurns()
    await writeFile(join(root, 'README.md'), 'mine, still being written\n', 'utf8')
    expect((await manager.land(WREN, '')).kind).toBe('landed')
    expect(await text(join(root, 'README.md'))).toBe('mine, still being written\n')
    expect((await git(['diff', '--name-only', 'HEAD~1', 'HEAD'], root)).trim().split('\n').sort()).toEqual(['cart.py', 'notes.md'])
  })

  it('names a conflict before touching anything; the teammate resolves it on its branch, and then it lands', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, tree, manager } = await twoTurns()
    // The person changed the same line meanwhile.
    await writeFile(join(root, 'cart.py'), 'def total(items):\n    return len(items)\n', 'utf8')
    await git(['commit', '-q', '-am', 'mine'], root)
    const head = (await git(['rev-parse', 'HEAD'], root)).trim()
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'conflicts', files: ['cart.py'] })
    expect((await manager.land(WREN, '')).kind).toBe('blocked')
    expect((await git(['rev-parse', 'HEAD'], root)).trim()).toBe(head)
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('')

    // In the teammate's tree only: the merge begun, the file to resolve named.
    expect(await manager.startResolving('tm_wren')).toEqual(['cart.py'])
    expect(await readFile(join(tree, 'cart.py'), 'utf8')).toContain('<<<<<<<')
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'merging' })
    // The teammate's turn resolves it; its checkpoint commits the merge.
    await writeFile(join(tree, 'cart.py'), 'def total(items):\n    return sum(items) if items else len(items)\n', 'utf8')
    expect((await manager.checkpoint('tm_wren', turn('Resolve the conflict with main'))).kind).toBe('committed')
    // Review says the merge is a merge, and the landing's message leaves it out.
    const review = await manager.review('tm_wren')
    expect(review.turns.find((one) => one.subject === 'Resolve the conflict with main')?.merge).toBe(true)
    expect(review.diff).toContain('+    return sum(items) if items else len(items)')
    const ready = await manager.landPreview(WREN)
    expect(ready.block).toBeUndefined()
    expect(ready.draft).not.toContain('Resolve the conflict')
    expect((await manager.land(WREN, '')).kind).toBe('landed')
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return sum(items) if items else len(items)\n')
  })

  it('finishes the merge even when the teammate resolved it by keeping its own side, which changes nothing', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, tree, manager } = await twoTurns()
    await writeFile(join(root, 'cart.py'), 'def total(items):\n    return len(items)\n', 'utf8')
    await git(['commit', '-q', '-am', 'mine'], root)
    await manager.startResolving('tm_wren')
    // Its own side, byte for byte: the tree then matches its last turn.
    await writeFile(join(tree, 'cart.py'), 'def total(items):\n    return sum(items)\n', 'utf8')
    const saved = await manager.checkpoint('tm_wren', turn('Keep mine'))
    expect(saved.kind).toBe('committed')
    if (saved.kind === 'committed') expect(saved.mergeFinished).toBe(true)
    expect((await manager.landPreview(WREN)).block).toBeUndefined()
  })

  it('refuses a branch that still carries conflict markers', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { tree, manager } = await twoTurns()
    await writeFile(join(tree, 'notes.md'), '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n', 'utf8')
    await manager.checkpoint('tm_wren', turn('Half a merge'))
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'markers', files: ['notes.md'] })
  })

  it('puts the checkout back exactly when the person\'s hook refuses the commit', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, manager } = await twoTurns()
    await writeFile(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', 'utf8')
    await chmod(join(root, '.git', 'hooks', 'pre-commit'), 0o755)
    await writeFile(join(root, 'README.md'), 'mine, unsaved\n', 'utf8')
    const head = (await git(['rev-parse', 'HEAD'], root)).trim()
    const landed = await manager.land(WREN, '')
    expect(landed.kind).toBe('refused')
    if (landed.kind === 'refused') expect(landed.message).toContain('lint failed')
    expect((await git(['rev-parse', 'HEAD'], root)).trim()).toBe(head)
    expect(await text(join(root, 'cart.py'))).toBe('def total(items):\n    return 0\n')
    expect(await exists(join(root, 'notes.md'))).toBe(false)
    expect(await text(join(root, 'README.md'))).toBe('mine, unsaved\n')
    expect((await git(['status', '--porcelain'], root)).trim()).toBe('M README.md')
    expect(await exists(join(root, '.git', 'SQUASH_MSG'))).toBe(false)
    // And the branch is still there to land once the hook is satisfied.
    expect((await manager.landPreview(WREN)).block).toBeUndefined()
  })

  it('refuses work no turn saved, and a checkout on no branch', { timeout: REAL_GIT_TIMEOUT_MS }, async () => {
    const { root, tree, manager } = await twoTurns()
    await writeFile(join(tree, 'scratch.txt'), 'by hand\n', 'utf8')
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'unsaved', files: ['scratch.txt'] })
    await rm(join(tree, 'scratch.txt'))
    await git(['checkout', '-q', '--detach'], root)
    expect((await manager.landPreview(WREN)).block).toEqual({ kind: 'detached' })
  })
})

describe('the pure parts', () => {
  it('needs git 2.38 to check conflicts without touching anything', () => {
    expect(gitVersionCanLand('2.54.0')).toBe(true)
    expect(gitVersionCanLand('2.38.0')).toBe(true)
    expect(gitVersionCanLand('2.37.9')).toBe(false)
  })

  it('drafts one ask plainly, and several as a list', () => {
    expect(landingDraft({ name: 'Wren', subjects: ['Fix it'], routes: ['codex / luna', 'codex / luna', ''] })).toBe('Fix it\n\nLocust-Teammate: Wren\nLocust-Route: codex / luna')
    expect(landingDraft({ name: 'Wren', subjects: [], routes: [] })).toBe("Wren's work\n\nLocust-Teammate: Wren")
  })
})
