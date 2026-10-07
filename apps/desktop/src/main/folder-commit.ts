import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { CHECKPOINT_MAX_FILE_BYTES, defaultRunGit, statusEntriesOf } from './worktrees.js'
import { ownGitArgs } from './git-guard.js'
import type { ChangeStatus, CommitResult, CommitThen, FolderChanges, FolderRemote } from '../shared/folder-commit.js'
import { blockedSentence } from '../shared/folder-commit.js'

/**
 * COMMIT, PUSH, PULL REQUEST (0.680): the folder's changes, saved in git by
 * the person, from the conversation that made them.
 *
 * A teammate on its own branch already has Review changes and Land. One that
 * works in the folder itself left its changes uncommitted, and the person
 * went to a terminal to commit them -- where the Codex app and Claude Code
 * each have a button. This is that button: everything changed in the folder,
 * committed as the person (their name, their hooks), and then, if they ask,
 * pushed, or pushed on a branch of its own with a pull request opened by
 * their own `gh`.
 *
 * Nothing happens without a press, and what a press would commit is listed
 * before it. A commit the person's hook refuses leaves the staging area
 * exactly as it was. `.locust/` (teammates' branches, comparison copies) is
 * never committed.
 */

export interface FolderCommitOptions {
  readonly runGit?: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
  /** git or gh with a longer limit and no terminal prompt, for what reaches the network. */
  readonly runNetwork?: (program: 'git' | 'gh', args: readonly string[], cwd: string) => Promise<string>
}

const NETWORK_TIMEOUT_MS = 120_000
/** Never `.locust/`: teammates' branches and comparison copies live there. */
const NOT_LOCUST = ['--', '.', ':(exclude).locust'] as const

function defaultRunNetwork(program: 'git' | 'gh', args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      program,
      program === 'git' ? ownGitArgs(args) : [...args],
      {
        cwd,
        windowsHide: true,
        timeout: NETWORK_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Nothing may stop to ask in a terminal nobody can see: a missing
        // credential is an error to report, not a hang.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 400)))
        else resolvePromise(String(stdout))
      }
    )
  })
}

const statusOf = (code: string): ChangeStatus =>
  code === '??' || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : code.includes('R') ? 'renamed' : 'modified'

/** `fix the cart total` -> `locust/fix-the-cart-total`: a branch name git takes, from the commit's subject. */
export function branchFromSubject(subject: string): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
    .slice(0, 48)
    .replace(/-+$/, '')
  return `locust/${slug.length === 0 ? 'changes' : slug}`
}

export function createFolderCommits(options: FolderCommitOptions = {}) {
  const runGit = options.runGit ?? defaultRunGit
  const runNetwork = options.runNetwork ?? defaultRunNetwork
  /** `gh auth status` for a few minutes at a time: it reaches GitHub, and the header asks often. */
  let signedIn: { readonly at: number; readonly ok: boolean } | undefined

  const ghSignedIn = async (folder: string): Promise<boolean> => {
    if (signedIn !== undefined && Date.now() - signedIn.at < 5 * 60_000) return signedIn.ok
    const ok = await runNetwork('gh', ['auth', 'status', '--hostname', 'github.com'], folder).then(() => true, () => false)
    signedIn = { at: Date.now(), ok }
    return ok
  }

  const remoteOf = async (folder: string, branch: string): Promise<FolderRemote | undefined> => {
    const url = (await runGit(['remote', 'get-url', 'origin'], folder).catch(() => '')).trim()
    if (url.length === 0) return undefined
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`], folder).then(() => true, () => false)
    const head = (await runGit(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], folder).catch(() => '')).trim()
    let defaultBranch = head.replace(/^origin\//, '')
    if (defaultBranch.length === 0) {
      // A clone that never set origin/HEAD: whichever of the usual names the remote has.
      const known = await runGit(['branch', '-r', '--format=%(refname:short)'], folder).catch(() => '')
      defaultBranch = /^origin\/main$/m.test(known) ? 'main' : /^origin\/master$/m.test(known) ? 'master' : 'main'
    }
    const github = /(^|[@/])github\.com[:/]/i.test(url)
    return { name: 'origin', upstream, defaultBranch, pullRequests: github && (await ghSignedIn(folder)) }
  }

  const changes = async (folder: string): Promise<FolderChanges> => {
    const inside = (await runGit(['rev-parse', '--is-inside-work-tree'], folder).catch(() => '')).trim()
    if (inside !== 'true') return { kind: 'none', why: 'not-a-repository' }
    // The folder must be the repository's top, or a commit would take changes the person never saw here.
    const top = (await runGit(['rev-parse', '--show-toplevel'], folder).catch(() => '')).trim()
    const norm = (path: string): string => path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
    if (top.length === 0 || norm(top) !== norm(folder)) return { kind: 'none', why: 'not-a-repository' }
    const entries = statusEntriesOf(await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...NOT_LOCUST], folder))
    const gitDir = (await runGit(['rev-parse', '--absolute-git-dir'], folder)).trim()
    const has = (name: string): Promise<boolean> => stat(join(gitDir, name)).then(() => true, () => false)
    const conflicted = entries.filter((entry) => /U|AA|DD/.test(entry.code)).map((entry) => entry.path)
    if (await has('MERGE_HEAD')) return { kind: 'blocked', why: 'merging', files: conflicted }
    if ((await has('rebase-merge')) || (await has('rebase-apply'))) return { kind: 'blocked', why: 'rebasing', files: conflicted }
    if (conflicted.length > 0) return { kind: 'blocked', why: 'conflicted', files: conflicted }
    if (entries.length === 0) return { kind: 'none', why: 'clean' }
    const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], folder).catch(() => '')).trim()
    if (branch.length === 0) return { kind: 'blocked', why: 'detached', files: [] }
    const remote = await remoteOf(folder, branch)
    return {
      kind: 'changes',
      branch,
      files: entries.map((entry) => ({ path: entry.path, status: statusOf(entry.code) })),
      ...(remote === undefined ? {} : { remote })
    }
  }

  const commit = async (folder: string, message: string, then: CommitThen): Promise<CommitResult> => {
    const now = await changes(folder)
    if (now.kind !== 'changes') {
      return { kind: 'refused', message: now.kind === 'none' ? 'There is nothing to commit in this folder now.' : blockedSentence(now.why) }
    }
    const text = message.trim()
    if (text.length === 0) return { kind: 'refused', message: 'A commit needs a message.' }
    if (then !== 'commit' && now.remote === undefined) return { kind: 'refused', message: 'This folder has no remote named origin to push to.' }
    if (then === 'pull-request' && now.remote?.pullRequests !== true) {
      return { kind: 'refused', message: 'A pull request needs a GitHub remote and the GitHub CLI signed in (gh auth login).' }
    }
    // A pull request from the default branch goes from a branch of its own, made first, so the
    // commit is never left on the person's main unpushed.
    let branch = now.branch
    let newBranch: string | undefined
    if (then === 'pull-request' && branch === now.remote?.defaultBranch) {
      const wanted = branchFromSubject(text.split('\n')[0] ?? text)
      let name = wanted
      for (let n = 2; await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], folder).then(() => true, () => false); n += 1) name = `${wanted}-${String(n)}`
      try {
        await runGit(['switch', '-q', '-c', name], folder)
      } catch (error) {
        return { kind: 'refused', message: `git could not make a branch for the pull request: ${error instanceof Error ? error.message : 'no reason given'}` }
      }
      branch = name
      newBranch = name
    }
    const backToStart = async (): Promise<void> => {
      if (newBranch === undefined) return
      await runGit(['switch', '-q', now.branch], folder).catch(() => '')
      await runGit(['branch', '-q', '-D', newBranch], folder).catch(() => '')
    }
    // What is staged now, to put back exactly if the commit is refused.
    let saved: string
    try {
      saved = (await runGit(['write-tree'], folder)).trim()
    } catch (error) {
      await backToStart()
      return { kind: 'refused', message: `git could not read what is staged: ${error instanceof Error ? error.message : 'no reason given'}` }
    }
    const leftOut: string[] = []
    try {
      await runGit(['add', '-A', ...NOT_LOCUST], folder, 5 * 60_000)
      for (const file of now.files.filter((one) => one.status === 'added')) {
        const bytes = await stat(join(folder, file.path)).then((found) => found.size, () => 0)
        if (bytes > CHECKPOINT_MAX_FILE_BYTES) leftOut.push(file.path)
      }
      if (leftOut.length > 0) await runGit(['reset', '-q', '--', ...leftOut], folder)
      await runGit(['commit', '-q', '-m', text], folder, 5 * 60_000)
    } catch (error) {
      await runGit(['read-tree', saved], folder).catch(() => '')
      await backToStart()
      const said = error instanceof Error ? error.message : ''
      return {
        kind: 'refused',
        message: /tell me who you are|user\.email|user\.name/i.test(said)
          ? 'git does not know your name and email yet, so it cannot make the commit as you. Set them with git config user.name and user.email, then commit again.'
          : /nothing (added )?to commit/i.test(said)
            ? 'There was nothing left to commit.'
            : `Your commit hooks refused the commit: ${said.replace(/^git commit:\s*/, '')}`
      }
    }
    const sha = (await runGit(['rev-parse', 'HEAD'], folder)).trim()
    const files = now.files.length - leftOut.length
    const done = { kind: 'done' as const, sha, branch, files, leftOut, ...(newBranch === undefined ? {} : { newBranch }) }
    if (then === 'commit') return done
    try {
      await runNetwork('git', ['push', ...(now.remote?.upstream === true && newBranch === undefined ? [] : ['-u']), 'origin', branch], folder)
    } catch (error) {
      return { ...done, pushed: false, after: `The push was refused: ${error instanceof Error ? error.message : 'no reason given'}` }
    }
    if (then === 'push') return { ...done, pushed: true }
    const [subject = text, ...rest] = text.split('\n')
    const body = rest.join('\n').trim()
    try {
      const said = await runNetwork('gh', ['pr', 'create', '--title', subject, '--body', body.length > 0 ? body : subject, '--head', branch, '--base', now.remote!.defaultBranch], folder)
      const url = /https:\/\/\S+\/pull\/\d+/.exec(said)?.[0]
      return { ...done, pushed: true, ...(url === undefined ? {} : { pullRequestUrl: url }) }
    } catch (error) {
      return { ...done, pushed: true, after: `GitHub did not open the pull request: ${error instanceof Error ? error.message : 'no reason given'}` }
    }
  }

  return { changes, commit }
}

export type FolderCommits = ReturnType<typeof createFolderCommits>
