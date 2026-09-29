import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { posix } from 'node:path'

/**
 * THE PATH A MAC TERMINAL HAS (the first macOS build, 2026-09-29).
 *
 * An app opened from the Dock or Finder is started by launchd with the bare
 * system PATH -- /usr/bin:/bin:/usr/sbin:/sbin -- not the one the person's
 * shell builds, so every CLI installed by Homebrew, npm or its own installer
 * would be "not installed" to Locust while `claude` works in Terminal. The
 * locator searches PATH only on macOS, so PATH is where the fix goes: the
 * login shell is asked for its PATH once, at launch, and the usual install
 * folders are added after it in case the shell cannot be asked.
 */
export function macInstallFolders(home: string): readonly string[] {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    posix.join(home, '.local', 'bin'),
    posix.join(home, '.npm-global', 'bin'),
    posix.join(home, '.opencode', 'bin'),
    posix.join(home, '.claude', 'local'),
    posix.join(home, '.bun', 'bin'),
    posix.join(home, '.volta', 'bin')
  ]
}

/** The shell's PATH merged over the one the app was given, first-seen order, no repeats. */
export function mergedPath(...lists: readonly (string | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const entry of (list ?? '').split(':')) {
      const directory = entry.trim()
      if (directory.length === 0 || seen.has(directory)) continue
      seen.add(directory)
      out.push(directory)
    }
  }
  return out.join(':')
}

/** Ask the login shell for its PATH; undefined when it cannot be asked in time. */
export function loginShellPath(
  shell: string | undefined,
  run: (shell: string, args: readonly string[]) => string = (command, args) =>
    execFileSync(command, [...args], { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] })
): string | undefined {
  const chosen = shell !== undefined && shell.startsWith('/') ? shell : '/bin/zsh'
  try {
    // Markers around the value: a shell profile that prints a greeting
    // must not end up inside PATH.
    const said = run(chosen, ['-ilc', 'printf "__LOCUST_PATH__%s__LOCUST_PATH__" "$PATH"'])
    const match = /__LOCUST_PATH__(.*?)__LOCUST_PATH__/s.exec(said)
    const value = match?.[1]?.trim()
    return value === undefined || value.length === 0 ? undefined : value
  } catch {
    return undefined
  }
}

/** The PATH Locust should run with on macOS; anything else is returned as it is. */
export function macPath(
  platform: NodeJS.Platform,
  current: string | undefined,
  options: { readonly shell?: string; readonly home?: string; readonly ask?: typeof loginShellPath } = {}
): string | undefined {
  if (platform !== 'darwin') return current
  const fromShell = (options.ask ?? loginShellPath)(options.shell)
  return mergedPath(fromShell, current, macInstallFolders(options.home ?? homedir()).join(':'))
}
