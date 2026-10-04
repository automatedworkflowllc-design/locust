/**
 * What every git that LOCUST runs on its own is told first.
 *
 * A repository's own `.git/config` can name a program for git to run, and
 * `core.fsmonitor` is the one with no precondition: `git status` runs it every
 * time. MEASURED 2026-09-25: a scratch repository with `core.fsmonitor` set
 * to a command that writes a file -- `git status` wrote it. Locust runs
 * `git status` by itself when a folder is opened (the diagnostics), before
 * and after every run that may write (disk observation) and in each
 * teammate's worktree, so opening a folder that carried such a config would
 * have run its program with no one asking. The same measurement found that
 * Claude Code and OpenCode, launched in that folder, do NOT run it: Locust
 * was the one that did.
 *
 * fsmonitor only makes git faster on very large trees, so nothing is lost by
 * turning it off for the handful of queries Locust makes. Hooks are left
 * alone on purpose: Git LFS works through a post-checkout hook, and a
 * teammate's worktree without it would have pointer files for content.
 */
export const OWN_GIT_CONFIG: readonly string[] = ['-c', 'core.fsmonitor=false']

export function ownGitArgs(args: readonly string[]): string[] {
  return [...OWN_GIT_CONFIG, ...args]
}
