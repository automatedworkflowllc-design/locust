import { spawnShape } from '@teammate/runtime-adapters'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import { releaseProcessTree } from '@teammate/runtime-adapters'

/**
 * One definition of how an app-server process is started and stopped, used
 * by both the mission transport and the model probe. Killing the TREE
 * matters: app-server starts children that outlive their parent.
 *
 * STOPPED ONCE, AND WITHOUT HOLDING THE APP.
 *
 * Both callers stop it twice: a turn's end kills it and then closes the
 * client, whose transport kills it again; the model probe disposes the client
 * and then kills it in `finally`. Each kill was a synchronous `taskkill`, and
 * MEASURED 2026-09-22 a synchronous taskkill holds the main process about
 * 79 ms for a two-process tree and still 75 ms once the tree is gone -- so
 * about 155 ms of an unresponsive app at the end of every Codex turn and
 * every model probe. Now the first stop walks the tree in the background and
 * the second is nothing.
 *
 * The background walk is safe HERE because nothing is signalled after it:
 * the order that forced the stop path to be synchronous (a parent killed in
 * the same tick leaves `/T` no tree to walk) cannot arise. If taskkill fails,
 * the process itself is still killed.
 */
export interface AppServerProcess {
  readonly write: (line: string) => void
  readonly kill: () => void
  readonly onData: (listener: (chunk: string) => void) => void
  readonly onExit: (listener: () => void) => void
}

/** What the process needs from the machine, so a test can stand in for it. */
export interface AppServerProcessDeps {
  readonly spawn: (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>) => AppServerChild
  readonly releaseTree: (pid: number) => Promise<boolean>
  readonly platform: NodeJS.Platform
}

/** The slice of a child process this module touches. */
export interface AppServerChild {
  readonly pid?: number
  readonly stdin: { write(line: string): unknown; on?(event: 'error', listener: () => void): unknown }
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  on(event: 'exit' | 'error', listener: () => void): unknown
  kill(): unknown
}

const MACHINE: AppServerProcessDeps = {
  // H7: the launch's own environment over the host's -- a CLI under the
  // app's own Node needs ELECTRON_RUN_AS_NODE, or this opens another Locust.
  // H8: and a .cmd launcher gets the command line cmd.exe reads correctly.
  spawn: (executablePath, args, env) => {
    const shape = spawnShape(executablePath, args)
    return spawn(executablePath, [...shape.args], {
      // Stderr is never read, so it is not piped: a full pipe nobody drains
      // stalls a chatty CLI (L4).
      stdio: ['pipe', 'pipe', 'ignore'],
      ...(shape.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
      ...(env === undefined ? {} : { env: { ...process.env, ...env } })
    })
  },
  releaseTree: releaseProcessTree,
  platform: process.platform
}

export function startAppServerProcess(
  executablePath: string,
  args: readonly string[],
  deps: AppServerProcessDeps = MACHINE,
  env?: Readonly<Record<string, string>>
): AppServerProcess {
  const child = deps.spawn(executablePath, args, env)
  // A write to a child that is gone is an 'error' on stdin; it is the exit's
  // business, not an exception (L4).
  child.stdin.on?.('error', () => undefined)
  // And the spawn's own failure is handled even before anyone asks onExit.
  child.on('error', () => undefined)
  let stopping = false
  const killChild = (): void => {
    try {
      child.kill()
    } catch {
      // Already gone.
    }
  }
  return {
    write: (line) => {
      child.stdin.write(line)
    },
    kill: () => {
      if (stopping) return
      stopping = true
      if (deps.platform === 'win32' && child.pid !== undefined) {
        void deps.releaseTree(child.pid).then((released) => {
          if (!released) killChild()
        })
        return
      }
      killChild()
    },
    onData: (listener) => {
      // One decoder across reads (M8): a character split between two pipe
      // reads was decoded half at a time, into replacement characters that
      // still parsed as JSON and went into the ledger.
      const decoder = new StringDecoder('utf8')
      child.stdout.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
        if (text.length > 0) listener(text)
      })
    },
    onExit: (listener) => {
      // A spawn that fails emits 'error' and never 'exit': it had no listener,
      // so it was an uncaught exception, and the turn waited out its timeout
      // for an exit nothing reported (L4). Either one is the end, said once.
      let ended = false
      const end = (): void => {
        if (ended) return
        ended = true
        listener()
      }
      child.on('exit', end)
      child.on('error', end)
    }
  }
}
