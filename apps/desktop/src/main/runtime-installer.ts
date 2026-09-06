import { spawn } from 'node:child_process'

import { installCommand, runtimeInstallFacts } from '../shared/runtime-install.js'

/**
 * Running `npm install -g <package>` for someone who has just opened Locust
 * and has nothing on their machine.
 *
 * Colin, 2026-09-06: "why would you not want to give the user the ability to
 * click something to get what they would need to make it work". The first
 * version of this only copied the command to the clipboard, which is a button
 * that hands someone their homework.
 *
 * What this file is careful about:
 *
 * - **It runs exactly the command the screen showed.** The line a person read
 *   before clicking and the argv spawned here come from one place
 *   (`installCommand`), so the app cannot show one thing and do another.
 * - **One install at a time.** A design limit, not a technical one: it means
 *   only one npm is ever talking, so a single line of output belongs to a
 *   single install, and nobody starts six and loses track of whose error is
 *   whose.
 * - **A failure is classified, not dumped.** Six shapes, each with a sentence
 *   about what happened and a sentence about what to do. A person who cannot
 *   read an npm trace still has to be able to act, and the command stays on
 *   screen so they, or someone helping them, can run it by hand.
 * - **"Exit 0 but still not there" is DETECTED, not guessed.** npm can exit
 *   clean and leave nothing runnable -- a half-written install, or a bin that
 *   is not where this machine looks. The caller re-probes and tells us.
 */

/** How an install ended, in the shape the screen draws. */
export type InstallOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false
      /** One sentence: what happened. */
      readonly what: string
      /** One sentence: what to do about it. */
      readonly next: string
      /** Whether restarting Locust is the action, rather than re-running. */
      readonly restart?: boolean
    }

export interface InstallProgress {
  /** The last line npm printed, already trimmed. */
  readonly line: string
}

export interface RuntimeInstaller {
  /** True while an install is running; every other button is disabled on it. */
  busy(): boolean
  install(input: {
    readonly runtime: string
    readonly onLine: (progress: InstallProgress) => void
  }): Promise<InstallOutcome>
}

export interface RuntimeInstallerOptions {
  /** Test seam: run the command, streaming lines, and resolve with how it ended. */
  readonly run?: (
    command: string,
    args: readonly string[],
    onLine: (line: string) => void
  ) => Promise<{ readonly code: number | null; readonly output: string }>
  /**
   * Whether the runtime can now be found. Called only after a clean exit --
   * this is what turns "npm said fine" into "there is something to run", and
   * it is the difference between detecting a half-written install and
   * guessing at one.
   */
  readonly nowInstalled?: (runtime: string) => Promise<boolean>
}

/** The most output kept for the disclosure. Bounded: this is not a terminal. */
export const MAX_OUTPUT_BYTES = 64 * 1024

const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|getaddrinfo/i
const PROXY = /407|proxy|tunneling socket|ERR_PROXY/i
const PERMISSION = /EACCES|EPERM|permission denied|operation not permitted/i
const PACKAGE = /E404|ETARGET|notarget|is not in this registry|No matching version/i

/**
 * Read npm's own words and say which of the six this was.
 *
 * Order matters: a proxy failure usually LOOKS like a network failure too, and
 * naming the proxy is the more useful of the two when both match.
 */
export function classifyInstallFailure(input: {
  readonly packageName: string
  readonly displayName: string
  readonly code: number | null
  readonly output: string
  readonly seconds: number
}): InstallOutcome {
  const { output } = input
  if (PROXY.test(output)) {
    return {
      ok: false,
      what: 'The npm registry refused the connection.',
      next: 'If this machine uses a proxy, npm needs to be told about it. The command below works in a terminal that already has one configured.'
    }
  }
  if (NETWORK.test(output)) {
    return {
      ok: false,
      what: 'npm could not reach the registry.',
      next: "Check this machine's connection and try again."
    }
  }
  if (PERMISSION.test(output)) {
    return {
      ok: false,
      what: 'npm could not write to its global folder.',
      next: 'Run the command below in a terminal with permission to install global packages.'
    }
  }
  if (PACKAGE.test(output)) {
    return {
      ok: false,
      what: `npm could not install ${input.packageName}.`,
      next: 'The package name may have changed. The command below is the one Locust would have run.'
    }
  }
  return {
    ok: false,
    what: `npm stopped with an error after ${String(input.seconds)}s.`,
    next: 'Show the output below — the last lines usually name the cause.'
  }
}

/** The one case that is not an error at all until the machine is asked again. */
export function installedButNotFound(displayName: string): InstallOutcome {
  return {
    ok: false,
    what: `${displayName} installed, but Locust still cannot find the command.`,
    next: 'It may need a new terminal session, or it may not be on this machine’s PATH. Restart Locust and it will look again.',
    restart: true
  }
}

function runNpm(
  command: string,
  args: readonly string[],
  onLine: (line: string) => void
): Promise<{ readonly code: number | null; readonly output: string }> {
  return new Promise((resolve) => {
    // `shell: true` because Windows will not spawn `npm.cmd` otherwise: without
    // it the child exits with a null code and no output, which is
    // indistinguishable from the install failing for a reason nobody can name.
    const child = spawn(command, [...args], { shell: true, windowsHide: true })
    let output = ''
    let pending = ''
    const take = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      if (output.length < MAX_OUTPUT_BYTES) output += text
      pending += text
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const said = line.trim()
        if (said.length > 0) onLine(said)
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => {
      resolve({ code: null, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      const last = pending.trim()
      if (last.length > 0) onLine(last)
      resolve({ code, output })
    })
  })
}

export function createRuntimeInstaller(options: RuntimeInstallerOptions = {}): RuntimeInstaller {
  const run = options.run ?? runNpm
  let running = false

  return {
    busy: () => running,
    async install({ runtime, onLine }) {
      const facts = runtimeInstallFacts(runtime)
      const line = installCommand(runtime)
      if (facts === undefined || facts.install.kind !== 'npm' || line === undefined) {
        return {
          ok: false,
          what: 'That runtime does not install from a package manager.',
          next: 'Its own page has the installer.'
        }
      }
      if (running) {
        return {
          ok: false,
          what: 'Another install is already running.',
          next: 'Wait for it to finish, then try this one.'
        }
      }
      running = true
      const startedAt = Date.now()
      try {
        // Split from the same string the screen showed, so the argv and the
        // displayed line cannot drift apart.
        const [command, ...args] = line.split(' ')
        const { code, output } = await run(command ?? 'npm', args, (said) => onLine({ line: said }))
        const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        if (code !== 0) {
          return classifyInstallFailure({
            packageName: facts.install.packageName,
            displayName: runtime,
            code,
            output,
            seconds
          })
        }
        // Clean exit is not the same as "there is something to run".
        const found = options.nowInstalled === undefined ? true : await options.nowInstalled(runtime)
        return found ? { ok: true } : installedButNotFound(runtime)
      } finally {
        running = false
      }
    }
  }
}
