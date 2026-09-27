import { spawn } from 'node:child_process'

import { killSpawnedTree } from '@teammate/runtime-adapters'
import { posix } from 'node:path'

/**
 * Where npm actually puts a globally installed command on this machine.
 *
 * The executable locator carries a table of install roots, and for anything
 * installed from npm that table names npm's DEFAULT prefix -- `%APPDATA%\npm`
 * on Windows, `/usr/local` elsewhere. That is only where a runtime lands if
 * nobody has moved it, and moving it is ordinary:
 *
 *   - corporate Windows, where the default folder is not writable
 *   - every nvm-style version manager
 *   - anyone who has ever hit EACCES and followed npm's own advice
 *   - **the exact remedy Locust prints** when an install fails on permissions:
 *     `npm config set prefix "%LOCALAPPDATA%\npm-global"`
 *
 * In all four the install succeeds and Locust then reports the runtime as not
 * installed, because a windowed app inherits a PATH that does not name the new
 * prefix and the table does not know about it. The person is told to install
 * something they have just installed.
 *
 * So the app asks npm rather than assuming. One child process at startup, and
 * the answer is used as a search root, never as a place to write.
 *
 * It answers `undefined` for every failure -- npm absent, a non-zero exit, a
 * timeout, unparseable output -- because the locator's other two passes are
 * unaffected and a machine without npm is not a machine with a broken Locust.
 */

/** Long enough for a cold npm on Windows, short enough not to hold up a launch. */
export const NPM_PREFIX_TIMEOUT_MS = 10_000

/**
 * The bin directory for a prefix, which is the prefix itself on Windows and
 * `<prefix>/bin` everywhere else.
 *
 * npm's own layout, not a guess: on Windows the shims sit directly in the
 * prefix beside `node_modules`, and on POSIX they go in `bin`. Getting this
 * wrong points the locator at a directory that exists and holds no commands,
 * which looks exactly like the runtime being absent.
 */
export function npmBinDirectoryFor(prefix: string, platform: NodeJS.Platform): string | undefined {
  const trimmed = prefix.trim()
  if (trimmed.length === 0) return undefined
  // `posix.join`, not `join`: the bare export follows the HOST separator, so
  // building a POSIX path on Windows came back separated by backslashes and
  // matched nothing. The locator imports the two namespaces separately for
  // exactly this reason.
  return platform === 'win32' ? trimmed : posix.join(trimmed, 'bin')
}

/**
 * Ask npm for its global prefix. Undefined when it cannot be asked or does not
 * answer with a usable path.
 */
export async function readNpmBinDirectory(options: {
  readonly platform?: NodeJS.Platform
  /** Test seam. Resolves to npm's stdout, or rejects the way a failure would. */
  readonly run?: () => Promise<string>
} = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform
  const run =
    options.run ??
    (() =>
      new Promise<string>((resolve, reject) => {
        // `shell: true` for the same reason the installer uses it: Windows
        // will not spawn `npm.cmd` without it. No user input reaches this
        // command line -- it is a constant -- so there is nothing here for a
        // shell to reinterpret.
        //
        // Its own timer and a TREE kill, not `execFile`'s `timeout`: that
        // kills the outer shell and leaves what it started, which is how a
        // hung `npm` shim survived Locust as `npm config get prefix` plus
        // its sleep (Fable, pass 1, finding 3).
        // One command string: an array beside `shell: true` is joined
        // unescaped anyway, and Node deprecates it (DEP0190).
        const child = spawn('npm config get prefix', {
          shell: true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          ...(platform === 'win32' ? {} : { detached: true })
        })
        let out = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          if (typeof child.pid === 'number') killSpawnedTree(child.pid, platform)
          reject(new Error('npm did not answer'))
        }, NPM_PREFIX_TIMEOUT_MS)
        child.stdout.on('data', (chunk: Buffer | string) => {
          out += String(chunk)
        })
        child.on('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (code === 0) resolve(out)
          else reject(new Error(`npm exited ${String(code)}`))
        })
      }))
  try {
    const said = await run()
    // npm prints the value and nothing else, but `null` is what it prints for
    // a config it does not have -- and a directory called "null" is not a
    // place to look for anything.
    const first = said.split('\n')[0]?.trim() ?? ''
    if (first.length === 0 || first === 'null' || first === 'undefined') return undefined
    return npmBinDirectoryFor(first, platform)
  } catch {
    return undefined
  }
}
