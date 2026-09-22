import { spawn } from 'node:child_process'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import { runtimeInstallFacts } from '../shared/runtime-install.js'
import type { RuntimeSignInResponse } from '../shared/ipc.js'

/**
 * Signing in to a runtime, from a button instead of from a terminal.
 *
 * Colin, 2026-09-22, about Muse: he was signed in to Meta in his browser,
 * Locust still read SIGN IN, and the only help on the row was `run muse
 * login` -- "idk where to even login ... the user would have to go through
 * all this drama no?". A CLI cannot see a browser's session; every one of
 * them needs its own sign-in once. What CAN go is the part where the person
 * has to find a terminal and know what to type.
 *
 * So this opens a real console window running the runtime's OWN sign-in
 * command. Not a pane inside Locust: these are interactive (Muse prints a
 * code to approve in the browser, Claude Code and Codex open their own
 * screens), and a real window is the one surface every one of them already
 * works in. The window stays open (`/k`) so the code, and whatever the CLI
 * said afterwards, can be read. Locust asks the machine again when the
 * window closes, and again on focus, which is how the row turns ready.
 *
 * Only the command named in the install facts is ever run, against the
 * executable discovery found -- the renderer sends a runtime id and nothing
 * else.
 */

/** The words after the command name, e.g. `muse login` -> `['login']`. */
export function signInArgs(runtime: string): readonly string[] | undefined {
  const line = runtimeInstallFacts(runtime)?.signIn
  if (line === undefined) return undefined
  return line.split(' ').filter((word) => word.length > 0).slice(1)
}

/**
 * The argument string for `cmd.exe`, passed verbatim.
 *
 * `/k` followed by a quoted whole: when the text after `/k` starts with a
 * quote, cmd strips the first and the last quote and runs what is left, so
 * `""C:\a b\muse.cmd" login"` runs `"C:\a b\muse.cmd" login` and a path with
 * a space in it survives. Node's own argument quoting does not produce this
 * shape, which is why it is built here and spawned verbatim.
 */
export function consoleCommandLine(path: string, args: readonly string[]): string {
  const tail = args.length === 0 ? '' : ` ${args.join(' ')}`
  return `/d /k ""${path}"${tail}"`
}

export interface RuntimeSignInOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  /** Called when the sign-in window closes, so the next ask is a fresh one. */
  readonly closed: () => void
  readonly platform?: NodeJS.Platform
}

export async function openSignIn(runtime: string, options: RuntimeSignInOptions): Promise<RuntimeSignInResponse> {
  const args = signInArgs(runtime)
  if (args === undefined) {
    return { ok: false, what: 'This runtime has no sign-in step.', next: 'Nothing to do here.' }
  }
  if ((options.platform ?? process.platform) !== 'win32') {
    // Built and measured on Windows only. A terminal on macOS or Linux is a
    // different program on every machine; this does not guess at one.
    return { ok: false, what: 'Signing in from here only works on Windows so far.', next: 'Run the command shown in a terminal.' }
  }
  const found = (await options.discover()).find((entry) => entry.id === runtime)
  const path = found?.executable?.discoveredPath
  if (path === undefined) {
    return { ok: false, what: 'Locust could not find this runtime on the machine.', next: 'Install it first, then sign in.' }
  }
  try {
    const child = spawn('cmd.exe', [consoleCommandLine(path, args)], {
      // Detached on Windows means a console of its own -- the visible window.
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      windowsVerbatimArguments: true
    })
    child.once('exit', () => options.closed())
    child.once('error', () => options.closed())
    child.unref()
    return { ok: true }
  } catch {
    return { ok: false, what: 'The sign-in window could not be opened.', next: 'Run the command shown in a terminal.' }
  }
}
