import { spawn } from 'node:child_process'
import { join } from 'node:path'

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
export interface InstallFailure {
      readonly ok: false
      /** One sentence: what happened. */
      readonly what: string
      /** One sentence: what to do about it. */
      readonly next: string
      /** Whether restarting Locust is the action, rather than re-running. */
      readonly restart?: boolean
      /**
       * The command to show, when it is NOT the one that just failed.
       *
       * A permission failure is the case this exists for: re-running the same
       * `npm install -g` in a terminal fails identically, because the global
       * prefix is what is unwritable. Left undefined, the screen keeps showing
       * the command Locust ran, which is right for every other failure.
       */
      readonly command?: string
}

export type InstallOutcome = { readonly ok: true } | InstallFailure

export interface InstallProgress {
  /** The last line npm printed, already trimmed. */
  readonly line: string
}

export interface RuntimeInstaller {
  /** True while an install is running; every other button is disabled on it. */
  busy(): boolean
  install(input: {
    readonly runtime: string
    /**
     * A release to install over the one there -- an update (runtime-updates.ts)
     * -- rather than whatever npm calls newest. Numbers and dots only.
     */
    readonly version?: string
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
  /**
   * The npm to use when the machine has none of its own.
   *
   * Absent means "there is nothing to fall back to", which is the state
   * every build was in before 2026-09-18 and the reason the Install buttons
   * were disabled rather than merely slow.
   */
  readonly bundledNpm?: {
    readonly nodePath: string
    readonly cliPath: string
    readonly env: Readonly<Record<string, string>>
    /**
     * Where it installs to. Without this npm picks a prefix from the
     * binary's own location -- the app's install folder -- which nothing
     * puts on PATH and the locator never searched. Grok's pass 10 measured
     * exactly that: "opencode installed, but Locust still cannot find the
     * command". The host owns this folder and tells the locator about it.
     */
    readonly prefix: string
  }
  /** Whether this machine has its own npm. Absent reads as yes. */
  readonly systemNpm?: () => Promise<boolean>
}

/** The most output kept for the disclosure. Bounded: this is not a terminal. */
export const MAX_OUTPUT_BYTES = 64 * 1024

const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|getaddrinfo/i
const PROXY = /407|proxy|tunneling socket|ERR_PROXY/i
const PERMISSION = /EACCES|EPERM|permission denied|operation not permitted/i
/** On Windows: a file npm must replace is held open by a running program. */
const IN_USE = /EBUSY|EPERM[^\n]{0,80}\b(?:rename|unlink|rmdir|scandir|open|copyfile)\b/i
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
  /** Which shell the remedy has to be typed into. Defaults to this machine. */
  readonly platform?: NodeJS.Platform
}): InstallFailure {
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
  // A B4 lead: on Windows this is nearly always a LOCK -- the CLI being
  // replaced is running -- and the advice below (move npm's prefix) sends a
  // person to reconfigure npm for nothing.
  if ((input.platform ?? process.platform) === 'win32' && IN_USE.test(output)) {
    return {
      ok: false,
      what: `A running program is holding ${input.displayName}'s files, so npm could not replace them.`,
      next: `Close anything using ${input.displayName} -- a terminal running it, or a Locust mission on it -- and try again.`
    }
  }
  if (PERMISSION.test(output)) {
    // Point npm at a folder this user owns, then install. Re-running the
    // failed command with more determination does not help: the global
    // prefix is the thing that is unwritable, and an administrator shell
    // would install it somewhere this user's PATH does not look anyway.
    const windows = (input.platform ?? process.platform) === 'win32'
    const prefix = windows ? '%LOCALAPPDATA%\\npm-global' : '~/.npm-global'
    return {
      ok: false,
      what: 'npm could not write to its global folder.',
      next: `Point npm at a folder you own and install again. Add ${prefix}${windows ? '' : '/bin'} to your PATH afterwards so Locust can find it.`,
      command: `npm config set prefix "${prefix}"\nnpm install -g ${input.packageName}`
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

/**
 * npm, run by the Node this app is made of.
 *
 * No shell: the binary's path holds "Program Files", and a shell would split
 * it at the space. Nothing else about the install changes -- the registry,
 * the prefix and the output are npm's own, so every failure this file already
 * knows how to explain reads the same way.
 */
async function runBundledNpm(
  bundled: {
    readonly nodePath: string
    readonly cliPath: string
    readonly env: Readonly<Record<string, string>>
    readonly prefix: string
  },
  args: readonly string[],
  packageName: string,
  onLine: (line: string) => void
): Promise<{ readonly code: number | null; readonly output: string }> {
  const unsafe = [...args, packageName].find((token) => !SAFE_ARGUMENT.test(token))
  if (unsafe !== undefined) {
    return {
      code: null,
      output: `Locust would not run this install: ${JSON.stringify(unsafe)} contains characters a shell reads as syntax.`
    }
  }
  /*
   * TWO THINGS THE FIRST DAY OF THIS TAUGHT, both measured on the shipped
   * build with nothing on PATH (2026-09-18, after Grok's pass 10 pressed the
   * button and got "installed, but Locust still cannot find the command").
   *
   * 1. The npm this app carries is npm 12, and npm 12 does not run a
   *    package's install scripts unless told to. OpenCode's platform binary
   *    is placed by exactly such a script, so the install "succeeded" and
   *    left a launcher that says "postinstall script was not run". The
   *    package the person asked for is allowed, and only that one.
   *
   * 2. That script runs `node ./postinstall.mjs` -- by name, through cmd.exe
   *    -- and there is no node on this machine. npm puts its own binary's
   *    folder on PATH for scripts, but the binary is Locust.exe, not
   *    node.exe. So a one-line shim called `node` is written into a folder
   *    Locust owns and put first on PATH for this one process. It forwards
   *    to the app's binary, which behaves as Node because the environment
   *    says so, and the shim's folder is inside the prefix, so it lives and
   *    dies with the install.
   *
   * With both: "added 3 packages in 6s", and the installed CLI answered its
   * version with no Node on PATH.
   */
  const { mkdir, writeFile } = await import('node:fs/promises')
  const shimDirectory = join(bundled.prefix, 'node-shim')
  await mkdir(shimDirectory, { recursive: true })
  if (process.platform === 'win32') {
    /*
     * `cmd.exe` reads a batch file in the console's OEM code page, not in
     * UTF-8, so a user name outside ASCII in the binary's path -- José,
     * Müller, 张伟 -- arrived as two or three wrong characters per letter and
     * the shim could not find Locust (Fable, pass 1, finding 11, from
     * reading). `chcp 65001` on the first line switches the console to UTF-8
     * before the line with the path is read. A `%` in the path is live
     * inside a .cmd and is doubled.
     */
    await writeFile(join(shimDirectory, 'node.cmd'), `@chcp 65001 >nul\r\n@"${bundled.nodePath.replace(/%/g, '%%')}" %*\r\n`, 'utf8')
  } else {
    await writeFile(join(shimDirectory, 'node'), `#!/bin/sh\nexec "${bundled.nodePath}" "$@"\n`, { encoding: 'utf8', mode: 0o755 })
  }
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const pathValue = `${shimDirectory}${process.platform === 'win32' ? ';' : ':'}${process.env[pathKey] ?? ''}`
  // The prefix is a path -- drive letter, backslashes, a space in a user
  // name -- so it fails the shell-safety check above on purpose. It never
  // meets a shell: this spawn has none, and the argument arrives whole.
  return new Promise((resolve) => {
    const child = spawn(
      bundled.nodePath,
      [bundled.cliPath, ...args, `--allow-scripts=${packageName}`, '--prefix', bundled.prefix],
      {
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...bundled.env, [pathKey]: pathValue }
      }
    )
    let output = ''
    let pending = ''
    const take = (chunk: Buffer): void => {
      output += chunk.toString()
      pending += chunk.toString()
      const lines = pending.split(String.fromCharCode(10))
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const said = line.trim()
        if (said.length > 0) onLine(said)
      }
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => {
      resolve({ code: null, output: `${output}${error.message}` })
    })
    child.on('close', (code) => {
      const last = pending.trim()
      if (last.length > 0) onLine(last)
      resolve({ code, output })
    })
  })
}

/** The one case that is not an error at all until the machine is asked again. */
export function installedButNotFound(displayName: string): InstallFailure {
  return {
    ok: false,
    what: `${displayName} installed, but Locust still cannot find the command.`,
    next: 'It may need a new terminal session, or it may not be on this machine’s PATH. Restart Locust and it will look again.',
    restart: true
  }
}

/**
 * The only shape a token handed to the shell may take.
 *
 * `shell: true` below is load-bearing on Windows and cannot go, which makes
 * this argv the one thing standing between an install and a shell. So the argv
 * is checked rather than trusted. Today it cannot fail: every token comes from
 * the constant table in `runtime-install.ts` — `npm install -g @openai/codex`
 * and three like it — and that is exactly the point. The day a package name
 * arrives from a config file, a manifest, or a runtime someone typed, this
 * refuses it instead of pasting it into a command line.
 *
 * Allowed: what an npm package or a flag actually needs (`@ / . _ - :`).
 * Refused: everything a shell reads as syntax — space, quote, `&`, `|`, `;`,
 * `$`, backtick, redirection, parentheses, newline.
 */
const SAFE_ARGUMENT = /^[A-Za-z0-9@/._:-]+$/

/** Whether this token can be handed to a shell without becoming syntax. */
export function safeToSpawn(token: string): boolean {
  return SAFE_ARGUMENT.test(token)
}

function runNpm(
  command: string,
  args: readonly string[],
  onLine: (line: string) => void
): Promise<{ readonly code: number | null; readonly output: string }> {
  const unsafe = [command, ...args].find((token) => !SAFE_ARGUMENT.test(token))
  if (unsafe !== undefined) {
    return Promise.resolve({
      code: null,
      output: `Locust would not run this install: ${JSON.stringify(unsafe)} contains characters a shell reads as syntax.`
    })
  }
  return new Promise((resolve) => {
    // `shell: true` because Windows will not spawn `npm.cmd` otherwise: without
    // it the child exits with a null code and no output, which is
    // indistinguishable from the install failing for a reason nobody can name.
    // One command string: every token passed SAFE_ARGUMENT above, so joining
    // them is exactly the line Node built from an array -- which it joins
    // unescaped, and deprecates (DEP0190).
    const child = spawn([command, ...args].join(' '), { shell: true, windowsHide: true })
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
  /*
   * Run npm the way this machine can.
   *
   * The person's own npm first: it is configured the way they expect, with
   * their registry, their proxy and their prefix. Ours is the answer when
   * there is no other, and it is spawned WITHOUT a shell -- the path holds
   * "Program Files", and a shell would split it.
   */
  const runInstall = async (
    command: string,
    args: readonly string[],
    packageName: string,
    onLine: (line: string) => void
  ): Promise<{ readonly code: number | null; readonly output: string }> => {
    const bundled = options.bundledNpm
    if (bundled === undefined || options.run !== undefined) return run(command, args, onLine)
    const hasOwn = options.systemNpm === undefined ? true : await options.systemNpm()
    if (hasOwn) return run(command, args, onLine)
    return runBundledNpm(bundled, args, packageName, onLine)
  }
  let running = false

  return {
    busy: () => running,
    async install({ runtime, version, onLine }) {
      const facts = runtimeInstallFacts(runtime)
      if (version !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version)) {
        return { ok: false, what: `"${version}" is not a version Locust installs.`, next: 'Nothing was changed.' }
      }
      const plain = installCommand(runtime)
      const line = plain === undefined || version === undefined ? plain : `${plain}@${version}`
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
        const { code, output } = await runInstall(command ?? 'npm', args, facts.install.packageName, (said) => onLine({ line: said }))
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
