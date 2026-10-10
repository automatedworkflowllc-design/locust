import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * NO TEAMMATE ENDS YOUR BROWSER (0.717): the settings every Claude Code run
 * is launched with (`--settings`), naming Locust's command guard as a
 * PreToolUse hook on the shell tools. resources/locust-command-guard.mjs says
 * what it refuses, and why.
 *
 * Claude Code runs a hook's command in its own shell -- Git Bash on Windows,
 * MEASURED 2026-10-10 on 2.1.296 -- so the command is written for a POSIX
 * shell: Electron's binary, run as node by ELECTRON_RUN_AS_NODE (guaranteed
 * present, as the permission bridge's is), on the script beside app.asar.
 * Forward slashes: Windows takes them, and a backslash means something to a
 * shell. `--settings` applies under `--restricted` too (Claude Code's help), so
 * every mode gets it, Auto included.
 *
 * LOCUST_GUARD_PARENT (0.718) is this Locust's own process id: a process the
 * run started descends from the agent Locust started for it, whose parent is
 * Locust, and the guard ends only those by id.
 */
export function commandGuardSettings(options: { readonly node: string; readonly guardPath: string; readonly parent: number }): string {
  const quoted = (path: string): string => `"${path.replace(/\\/g, '/').replace(/(["$`])/g, '\\$1')}"`
  const parent = Number.isInteger(options.parent) && options.parent > 0 ? options.parent : 0
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell',
            hooks: [{ type: 'command', command: `ELECTRON_RUN_AS_NODE=1 LOCUST_GUARD_PARENT=${String(parent)} ${quoted(options.node)} ${quoted(options.guardPath)}`, timeout: 15 }]
          }
        ]
      }
    },
    null,
    2
  )
}

/** Written once at start, in the profile; undefined if it could not be, and runs go without it. */
export async function writeCommandGuard(folder: string, options: { readonly node: string; readonly guardPath: string; readonly parent: number }): Promise<string | undefined> {
  try {
    await mkdir(folder, { recursive: true })
    const path = join(folder, 'command-guard.json')
    await writeFile(path, commandGuardSettings(options), 'utf8')
    return path
  } catch {
    return undefined
  }
}
