import { spawn } from 'node:child_process'

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
  readonly stdin: { write(line: string): unknown }
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  on(event: 'exit', listener: () => void): unknown
  kill(): unknown
}

const MACHINE: AppServerProcessDeps = {
  // H7: the launch's own environment over the host's -- a CLI under the
  // app's own Node needs ELECTRON_RUN_AS_NODE, or this opens another Locust.
  spawn: (executablePath, args, env) =>
    spawn(executablePath, [...args], { stdio: ['pipe', 'pipe', 'pipe'], ...(env === undefined ? {} : { env: { ...process.env, ...env } }) }),
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
      child.stdout.on('data', (chunk) => listener(String(chunk)))
    },
    onExit: (listener) => {
      child.on('exit', () => listener())
    }
  }
}
