import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { createNodeProbeRunner } from '@teammate/runtime-adapters'

import { startAppServerProcess } from './app-server-process.js'
import type { AppServerProcessDeps } from './app-server-process.js'

/**
 * H7: A CLI RUN UNDER THE APP'S OWN NODE RUNS AS THE CLI.
 *
 * On a machine without Node, a CLI npm installed (Codex, Copilot, Claude
 * Code: all .js launchers) runs as the app binary plus the script, with
 * ELECTRON_RUN_AS_NODE=1. Only the mission runner carried that variable;
 * the probes, app-server and the connector read dropped it, and each opened
 * another copy of Locust instead of the CLI.
 */
const folders: string[] = []
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('a probe of a CLI launched through the app binary', () => {
  it.runIf(process.platform === 'win32')('runs the script as Node when the launch carries ELECTRON_RUN_AS_NODE -- the real Electron binary', async () => {
    const electron = createRequire(import.meta.url)('electron') as unknown as string
    const folder = await mkdtemp(join(tmpdir(), 'locust-own-node-'))
    folders.push(folder)
    const script = join(folder, 'cli.js')
    await writeFile(script, "process.stdout.write('CLI RAN ' + String(typeof process.versions.node))\n", 'utf8')
    const runner = createNodeProbeRunner()
    const result = await runner.run({ purpose: 'version', executablePath: electron, args: [script], timeoutMs: 20_000, env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(result.stdout).toBe('CLI RAN string')
  }, 30_000)
})

describe('an app-server started for such a CLI', () => {
  it('is spawned with the launch’s environment', () => {
    const seen: (Readonly<Record<string, string>> | undefined)[] = []
    const deps: AppServerProcessDeps = {
      spawn: (_path: string, _args: readonly string[], env?: Readonly<Record<string, string>>) => {
        seen.push(env)
        return { stdin: { write: () => true }, stdout: { on: () => undefined }, on: () => undefined, kill: () => true }
      },
      releaseTree: () => undefined,
      platform: 'win32'
    } as unknown as AppServerProcessDeps
    startAppServerProcess('Locust.exe', ['codex.js', 'app-server'], deps, { ELECTRON_RUN_AS_NODE: '1' })
    expect(seen).toEqual([{ ELECTRON_RUN_AS_NODE: '1' }])
  })
})
