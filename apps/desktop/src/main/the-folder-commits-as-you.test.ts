import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { branchFromSubject, createFolderCommits } from './folder-commit.js'
import { commitDraft } from '../shared/folder-commit.js'

/**
 * THE FOLDER COMMITS AS YOU (0.680).
 *
 * What a teammate changed in the folder itself, committed by the person from
 * the conversation: as them, with their hooks, never `.locust/`, a refused
 * commit leaving the staging area as it was -- then pushed, or pushed on a
 * branch of its own with a pull request, when they ask.
 */
const TIMEOUT = 60_000
const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
const git = (args: readonly string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => execFile('git', [...args], { cwd, windowsHide: true }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(String(stdout)))))
const NL = String.fromCharCode(10)

async function repository(): Promise<{ readonly folder: string; readonly bare: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'locust-commit-ws-'))
  const bare = await mkdtemp(join(tmpdir(), 'locust-commit-remote-'))
  made.push(folder, bare)
  await git(['init', '-q', '--bare', '-b', 'main'], bare)
  await git(['init', '-q', '-b', 'main'], folder)
  await git(['config', 'user.email', 'you@example.test'], folder)
  await git(['config', 'user.name', 'You'], folder)
  await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return 0${NL}`)
  await git(['add', '.'], folder)
  await git(['commit', '-q', '-m', 'first'], folder)
  // GitHub by its URL, the local bare repository by its push URL.
  await git(['remote', 'add', 'origin', 'https://github.com/someone/pebble.git'], folder)
  await git(['remote', 'set-url', '--push', 'origin', bare], folder)
  await git(['push', '-q', '-u', 'origin', 'main'], folder)
  await git(['remote', 'set-head', 'origin', 'main'], folder)
  return { folder, bare }
}

/** Real git for pushes; a stand-in gh that is signed in and opens pull request 7. */
function network(calls: string[][]) {
  return async (program: 'git' | 'gh', args: readonly string[], cwd: string): Promise<string> => {
    calls.push([program, ...args])
    if (program === 'git') return git(args, cwd)
    if (args[0] === 'auth') return 'Logged in'
    if (args[0] === 'pr') return `https://github.com/someone/pebble/pull/7${NL}`
    throw new Error('unexpected gh call')
  }
}

describe('the folder commits as you', () => {
  it('lists what a commit would take, never .locust/', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    await writeFile(join(folder, 'notes.md'), `new${NL}`)
    await mkdir(join(folder, '.locust', 'worktrees', 'tm_wren'), { recursive: true })
    await writeFile(join(folder, '.locust', 'worktrees', 'tm_wren', 'x.txt'), 'not yours to commit')
    const commits = createFolderCommits({ runNetwork: network([]) })
    const seen = await commits.changes(folder)
    expect(seen).toMatchObject({ kind: 'changes', branch: 'main', remote: { name: 'origin', upstream: true, defaultBranch: 'main', pullRequests: true } })
    if (seen.kind !== 'changes') return
    expect(seen.files).toEqual([{ path: 'cart.py', status: 'modified' }, { path: 'notes.md', status: 'added' }])
  })

  it('commits everything as you, with your hooks, and says what it did', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    await mkdir(join(folder, '.locust'), { recursive: true })
    await writeFile(join(folder, '.locust', 'keep.txt'), 'no')
    const commits = createFolderCommits({ runNetwork: network([]) })
    const done = await commits.commit(folder, `Fix the cart total${NL}${NL}Locust-Teammate: Wren`, 'commit')
    expect(done).toMatchObject({ kind: 'done', branch: 'main', files: 1 })
    expect((await git(['log', '-1', '--format=%an <%ae>|%s'], folder)).trim()).toBe('You <you@example.test>|Fix the cart total')
    expect((await git(['show', '--name-only', '--format=', 'HEAD'], folder)).trim()).toBe('cart.py')
    expect(await commits.changes(folder)).toEqual({ kind: 'none', why: 'clean' })
  })

  it('a hook that refuses leaves what you had staged exactly as it was', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    await writeFile(join(folder, 'staged.md'), `staged${NL}`)
    await writeFile(join(folder, 'loose.md'), `loose${NL}`)
    await git(['add', 'staged.md'], folder)
    await writeFile(join(folder, '.git', 'hooks', 'pre-commit'), `#!/bin/sh${NL}echo "lint failed" >&2${NL}exit 1${NL}`)
    await chmod(join(folder, '.git', 'hooks', 'pre-commit'), 0o755)
    const before = await git(['status', '--porcelain'], folder)
    const head = (await git(['rev-parse', 'HEAD'], folder)).trim()
    const refused = await createFolderCommits({ runNetwork: network([]) }).commit(folder, 'Try', 'commit')
    expect(refused.kind).toBe('refused')
    if (refused.kind === 'refused') expect(refused.message).toMatch(/hooks refused the commit: .*lint failed/)
    expect(await git(['status', '--porcelain'], folder)).toBe(before)
    expect((await git(['rev-parse', 'HEAD'], folder)).trim()).toBe(head)
  })

  it('commit and push sends it to the branch it tracks', { timeout: TIMEOUT }, async () => {
    const { folder, bare } = await repository()
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    const calls: string[][] = []
    const done = await createFolderCommits({ runNetwork: network(calls) }).commit(folder, 'Fix the cart total', 'push')
    expect(done).toMatchObject({ kind: 'done', pushed: true })
    expect(calls.find((call) => call[1] === 'push')).toEqual(['git', 'push', 'origin', 'main'])
    expect((await git(['log', '-1', '--format=%s', 'main'], bare)).trim()).toBe('Fix the cart total')
  })

  it('a pull request from main goes from a branch of its own, and main is left where it was', { timeout: TIMEOUT }, async () => {
    const { folder, bare } = await repository()
    const main = (await git(['rev-parse', 'main'], folder)).trim()
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    const calls: string[][] = []
    const done = await createFolderCommits({ runNetwork: network(calls) }).commit(folder, `Fix the cart total${NL}${NL}- Fix the cart total`, 'pull-request')
    expect(done).toMatchObject({ kind: 'done', branch: 'locust/fix-the-cart-total', newBranch: 'locust/fix-the-cart-total', pushed: true, pullRequestUrl: 'https://github.com/someone/pebble/pull/7' })
    expect((await git(['rev-parse', 'main'], folder)).trim()).toBe(main)
    expect((await git(['symbolic-ref', '--short', 'HEAD'], folder)).trim()).toBe('locust/fix-the-cart-total')
    expect((await git(['log', '-1', '--format=%s', 'locust/fix-the-cart-total'], bare)).trim()).toBe('Fix the cart total')
    expect(calls.find((call) => call[0] === 'gh' && call[1] === 'pr')).toEqual(['gh', 'pr', 'create', '--title', 'Fix the cart total', '--body', '- Fix the cart total', '--head', 'locust/fix-the-cart-total', '--base', 'main'])
  })

  it('a refused push keeps the commit and says so', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await git(['remote', 'set-url', '--push', 'origin', join(folder, 'no-such-remote')], folder)
    await writeFile(join(folder, 'cart.py'), `def total(items):${NL}    return sum(items)${NL}`)
    const done = await createFolderCommits({ runNetwork: network([]) }).commit(folder, 'Fix', 'push')
    expect(done).toMatchObject({ kind: 'done', pushed: false })
    if (done.kind === 'done') expect(done.after).toMatch(/^The push was refused/)
  })

  it('no pull request without GitHub, and nothing at all mid-merge', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await git(['remote', 'set-url', 'origin', 'https://gitlab.com/someone/pebble.git'], folder)
    await writeFile(join(folder, 'cart.py'), `x${NL}`)
    const commits = createFolderCommits({ runNetwork: network([]) })
    const seen = await commits.changes(folder)
    expect(seen.kind === 'changes' && seen.remote?.pullRequests).toBe(false)
    expect((await commits.commit(folder, 'x', 'pull-request')).kind).toBe('refused')
    await writeFile(join(folder, '.git', 'MERGE_HEAD'), `${(await git(['rev-parse', 'HEAD'], folder)).trim()}${NL}`)
    expect(await commits.changes(folder)).toMatchObject({ kind: 'blocked', why: 'merging' })
  })

  it('a folder inside a repository, not its top, offers nothing', { timeout: TIMEOUT }, async () => {
    const { folder } = await repository()
    await mkdir(join(folder, 'sub'))
    await writeFile(join(folder, 'sub', 'a.txt'), 'a')
    expect(await createFolderCommits({ runNetwork: network([]) }).changes(join(folder, 'sub'))).toEqual({ kind: 'none', why: 'not-a-repository' })
  })

  it('drafts from the asks, and names a branch from the subject', () => {
    expect(commitDraft({ asks: ['Fix the cart total', 'and add a test'], teammate: 'Wren' })).toBe(
      `Fix the cart total${NL}${NL}- Fix the cart total${NL}- and add a test${NL}${NL}Locust-Teammate: Wren`
    )
    expect(commitDraft({ asks: [] })).toBe('Changes')
    // A long ask's first sentence, when it fits; README.md's dot is not a sentence's end.
    expect(commitDraft({ asks: ["Add one line at the end of README.md: 'Hello from Wren.' Change nothing else."] })).toBe("Add one line at the end of README.md: 'Hello from Wren.'")
    expect(branchFromSubject('Fix the cart total!')).toBe('locust/fix-the-cart-total')
    expect(branchFromSubject('???')).toBe('locust/changes')
  })
})
