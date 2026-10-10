import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createOpenCodeRunCommand, createOpenCodeServeCommand, withOpenCodeGuard } from '@teammate/runtime-adapters'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { stoppedBecause } from '../../resources/locust-command-guard.mjs'
import { openCodeCommandGuardPlugin, writeOpenCodeCommandGuard } from './command-guard.js'

/*
 * NO TEAMMATE ENDS YOUR BROWSER, OPENCODE TOO (0.722). MEASURED 2026-10-10 on
 * OpenCode 1.18.27 with a free model and Locust's own edit-mode config: a
 * plugin named in OPENCODE_CONFIG_CONTENT is handed each `bash` command in
 * `tool.execute.before`, and an Error it throws stops the command. A plugin
 * that is missing, or throws as it loads, is skipped and the run goes on.
 */
const GUARD = fileURLToPath(new URL('../../resources/locust-command-guard.mjs', import.meta.url))
const PLUGIN = 'file:///C:/Users/Jane/AppData/Roaming/Locust/opencode-command-guard.js'
const launch = { commandName: 'opencode', discoveredPath: 'C:\\tools\\opencode.exe', executablePath: 'C:\\tools\\opencode.exe', prefixArgs: [], kind: 'native' } as ExecutableLaunch
const configOf = (env: Readonly<Record<string, string>> | undefined): { plugin?: unknown[] } => JSON.parse(env?.OPENCODE_CONFIG_CONTENT ?? '{}') as { plugin?: unknown[] }

type Hook = (input: { tool: string }, output: { args: Record<string, unknown> }) => Promise<void>
/** The plugin Locust writes, loaded as OpenCode loads it, with the guard at this path run by this node. */
const loaded = async (node: string, guardPath: string): Promise<Hook> => {
  const file = join(await mkdtemp(join(tmpdir(), 'locust-opencode-guard-')), 'opencode-command-guard.js')
  await writeFile(file, openCodeCommandGuardPlugin({ node, guardPath, parent: process.pid }), 'utf8')
  const plugin = (await import(pathToFileURL(file).href)) as { LocustCommandGuard: () => Promise<Record<string, Hook>> }
  return (await plugin.LocustCommandGuard())['tool.execute.before']!
}

describe('the plugin every OpenCode run is told to load', () => {
  it('is added to the config’s plugin list, beside any already there, and nothing is added without one', () => {
    expect(JSON.parse(withOpenCodeGuard(JSON.stringify({ permission: { bash: 'ask' }, plugin: ['opencode-foo'] }), PLUGIN))).toEqual({ permission: { bash: 'ask' }, plugin: ['opencode-foo', PLUGIN] })
    expect(withOpenCodeGuard('{"tools":{"question":false}}', undefined)).toBe('{"tools":{"question":false}}')
  })

  it('is named on the run route and on the server, Approve each included, in every mode', () => {
    for (const sandbox of ['read-only', 'workspace-write', 'full-access'] as const) {
      expect(configOf(createOpenCodeRunCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'go', sandbox, openCodeGuardPlugin: PLUGIN }).env).plugin).toEqual([PLUGIN])
      expect(configOf(createOpenCodeServeCommand(launch, { workspacePath: 'C:\\work\\pebble', sandbox, openCodeGuardPlugin: PLUGIN }).env).plugin).toEqual([PLUGIN])
    }
    expect(configOf(createOpenCodeServeCommand(launch, { workspacePath: 'C:\\work\\pebble', openCodeGuardPlugin: PLUGIN }).env).plugin).toEqual([PLUGIN])
    expect(configOf(createOpenCodeRunCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'go', sandbox: 'workspace-write' }).env).plugin).toBeUndefined()
  })

  it('is written in the profile and named by its file URL', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'locust-opencode-guard-'))
    const url = await writeOpenCodeCommandGuard(folder, { node: process.execPath, guardPath: GUARD, parent: process.pid })
    expect(url).toBe(pathToFileURL(join(folder, 'opencode-command-guard.js')).href)
    expect(await readFile(fileURLToPath(url!), 'utf8')).toBe(openCodeCommandGuardPlugin({ node: process.execPath, guardPath: GUARD, parent: process.pid }))
  })

  it('refuses, with the guard’s own reason, what the guard refuses, and lets the rest through', async () => {
    const before = await loaded(process.execPath, GUARD)
    await expect(before({ tool: 'bash' }, { args: { command: 'taskkill /F /IM msedge.exe' } })).rejects.toThrow(stoppedBecause('taskkill /F /IM msedge.exe', () => undefined)!)
    await expect(before({ tool: 'bash' }, { args: { command: 'npm test' } })).resolves.toBeUndefined()
    // Only commands are its business.
    await expect(before({ tool: 'edit' }, { args: { filePath: 'taskkill.txt' } })).resolves.toBeUndefined()
  }, 30_000)

  it('lets the command run when the guard cannot be started, as OpenCode does for a plugin it cannot load', async () => {
    const before = await loaded('C:\\nowhere\\Locust.exe', 'C:\\nowhere\\locust-command-guard.mjs')
    await expect(before({ tool: 'bash' }, { args: { command: 'taskkill /F /IM msedge.exe' } })).resolves.toBeUndefined()
  }, 30_000)
})
