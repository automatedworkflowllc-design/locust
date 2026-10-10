import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { CHECKPOINT_MAX_FILE_BYTES, defaultRunGit, statusEntriesOf } from './worktrees.js'
import { ownGitArgs } from './git-guard.js'
import type { ChangeStatus, CommitResult, CommitThen, FolderChanges, FolderRemote } from '../shared/folder-commit.js'
import { blockedSentence } from '../shared/folder-commit.js'
import { githubRepoOf } from './cloud-tasks.js'
import { PULL_REQUEST_FIELDS, pullRequestOf, type FolderPullRequest } from '../shared/pull-request.js'

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
/** A branch name Locust hands to git: never one that starts with a dash or carries anything unusual. */
const SAFE_BRANCH = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/
const sameFiles = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && [...left].sort().every((path, index) => path === [...right].sort()[index])
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
    // GitHub by the URL's own host (Sol's review: https://evil.example/github.com/owner/repo.git passed the old test).
    const github = githubRepoOf(url) !== undefined && SAFE_BRANCH.test(defaultBranch)
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
    if (!SAFE_BRANCH.test(branch)) return { kind: 'blocked', why: 'branch-name', files: [] }
    const remote = await remoteOf(folder, branch)
    return {
      kind: 'changes',
      branch,
      files: entries.map((entry) => ({ path: entry.path, status: statusOf(entry.code) })),
      ...(remote === undefined ? {} : { remote })
    }
  }

  const commit = async (folder: string, message: string, then: CommitThen, shown?: readonly string[]): Promise<CommitResult> => {
    const now = await changes(folder)
    if (now.kind !== 'changes') {
      return { kind: 'refused', message: now.kind === 'none' ? 'There is nothing to commit in this folder now.' : blockedSentence(now.why) }
    }
    // Bound to what the person was shown (Sol's review): a file that changed or appeared since is not taken unseen.
    if (shown !== undefined && !sameFiles(shown, now.files.map((file) => file.path))) {
      return { kind: 'refused', message: 'The folder changed since this was opened, so nothing was committed. Look at the list again, then commit.' }
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
        // A post-checkout hook fails AFTER the switch (Sol's review): back to where it was, the new branch gone.
        const onNow = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], folder).catch(() => '')).trim()
        if (onNow === name) {
          await runGit(['switch', '-q', now.branch], folder).catch(() => '')
          await runGit(['branch', '-q', '-D', name], folder).catch(() => '')
        }
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
    let staged: string | undefined
    try {
      // Already staged under .locust/ (Sol's review): taken off the index, never committed.
      const locustStaged = (await runGit(['diff', '--cached', '--name-only', '-z', '--', '.locust'], folder)).split('\0').filter((file) => file.length > 0)
      if (locustStaged.length > 0) await runGit(['reset', '-q', '--', '.locust'], folder)
      await runGit(['add', '-A', ...NOT_LOCUST], folder, 5 * 60_000)
      for (const file of now.files.filter((one) => one.status === 'added')) {
        const bytes = await stat(join(folder, file.path)).then((found) => found.size, () => 0)
        if (bytes > CHECKPOINT_MAX_FILE_BYTES) leftOut.push(file.path)
      }
      if (leftOut.length > 0) await runGit(['reset', '-q', '--', ...leftOut], folder)
      staged = (await runGit(['write-tree'], folder)).trim()
      await runGit(['commit', '-q', '-m', text], folder, 5 * 60_000)
    } catch (error) {
      // Put back only if the index is still what Locust staged (Sol's review): a person who staged something else
      // while a slow hook ran keeps it, and is told.
      const current = await runGit(['write-tree'], folder).then((tree) => tree.trim(), () => undefined)
      const ours = staged === undefined || current === staged
      if (ours) await runGit(['read-tree', saved], folder).catch(() => '')
      await backToStart()
      const said = error instanceof Error ? error.message : ''
      const kept = ours ? '' : ' What is staged changed while the commit ran, so Locust left it as it is.'
      return {
        kind: 'refused',
        message: (/tell me who you are|user\.email|user\.name/i.test(said)
          ? 'git does not know your name and email yet, so it cannot make the commit as you. Set them with git config user.name and user.email, then commit again.'
          : /nothing (added )?to commit/i.test(said)
            ? 'There was nothing left to commit.'
            : `Your commit hooks refused the commit: ${said.replace(/^git commit:\s*/, '')}`) + kept
      }
    }
    const sha = (await runGit(['rev-parse', 'HEAD'], folder)).trim()
    const files = now.files.length - leftOut.length
    const done = { kind: 'done' as const, sha, branch, files, leftOut, ...(newBranch === undefined ? {} : { newBranch }) }
    if (then === 'commit') return done
    try {
      await runNetwork('git', ['push', ...(now.remote?.upstream === true && newBranch === undefined ? [] : ['-u']), 'origin', `refs/heads/${branch}:refs/heads/${branch}`], folder)
    } catch (error) {
      return { ...done, pushed: false, after: `The push was refused: ${error instanceof Error ? error.message : 'no reason given'}` }
    }
    if (then === 'push') return { ...done, pushed: true }
    const [subject = text, ...rest] = text.split('\n')
    const body = rest.join('\n').trim()
    try {
      // Each value joined to its flag, so none of them can be read as a flag of its own.
      const said = await runNetwork('gh', ['pr', 'create', `--title=${subject}`, `--body=${body.length > 0 ? body : subject}`, `--head=${branch}`, `--base=${now.remote!.defaultBranch}`], folder)
      const url = /https:\/\/\S+\/pull\/\d+/.exec(said)?.[0]
      // The header asks for the new one at once, not after the minute its last look is kept.
      pullRequests.delete(folder)
      return { ...done, pushed: true, ...(url === undefined ? {} : { pullRequestUrl: url }) }
    } catch (error) {
      return { ...done, pushed: true, after: `GitHub did not open the pull request: ${error instanceof Error ? error.message : 'no reason given'}` }
    }
  }

  /** The last look at each folder's pull request, for a minute: the header asks when it is shown and when the window comes back. */
  const pullRequests = new Map<string, { readonly at: number; readonly branch: string; readonly found: FolderPullRequest | undefined }>()

  /**
   * The pull request for the branch the folder is on (shared/pull-request.ts), or undefined: not a GitHub
   * folder, gh not signed in, on the default branch, or no pull request for this branch.
   */
  const pullRequest = async (folder: string): Promise<FolderPullRequest | undefined> => {
    const branch = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], folder).catch(() => '')).trim()
    if (branch.length === 0 || !SAFE_BRANCH.test(branch)) return undefined
    const kept = pullRequests.get(folder)
    if (kept !== undefined && kept.branch === branch && Date.now() - kept.at < 60_000) return kept.found
    const remote = await remoteOf(folder, branch)
    let found: FolderPullRequest | undefined
    if (remote?.pullRequests === true && branch !== remote.defaultBranch) {
      // No pull request for the branch is an error from gh; it is an answer here. Asked of the checked-out branch, not
      // by its name (0.731): MEASURED 2026-10-10, `gh pr view my-first-change` found nothing for a pull request from
      // a fork checked out with `gh pr checkout`, and plain `gh pr view` there found it by the branch's tracking.
      found = await runNetwork('gh', ['pr', 'view', '--json', PULL_REQUEST_FIELDS], folder).then(pullRequestOf, () => undefined)
    }
    pullRequests.set(folder, { at: Date.now(), branch, found })
    return found
  }

  /** After a sign-in in Settings, the next look asks gh again rather than its answer from before. */
  const forgetSignIn = (): void => {
    signedIn = undefined
    pullRequests.clear()
  }

  return { changes, commit, forgetSignIn, pullRequest }
}

export type FolderCommits = ReturnType<typeof createFolderCommits>
