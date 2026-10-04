import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { TASK_VARIABLE, cloudTaskText, createClaudeCloud, windowsCommandLine } from './claude-cloud.js'

/**
 * A TASK GOES TO CLAUDE'S CLOUD (0.538). `claude --cloud` needs a real
 * terminal, so Locust opens one -- and what the person wrote must reach
 * Claude Code as words, never as part of a command line cmd reads.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const store = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-claude-cloud-'))
  roots.push(root)
  return join(root, 'claude-cloud.json')
}
const claude = (path = 'C:\\Users\\a b\\AppData\\Roaming\\npm\\claude.cmd') => async () => [{
  id: 'claude',
  executable: { discoveredPath: path, executablePath: path, prefixArgs: [] as string[] }
}] as never
const spawned: { file: string; args: readonly string[]; options: { cwd?: string; env?: Record<string, string>; detached?: boolean; windowsVerbatimArguments?: boolean } }[] = []
const fakeSpawn = ((file: string, args: readonly string[], options: never) => {
  spawned.push({ file, args, options })
  return { once: () => undefined, unref: () => undefined }
}) as never

describe('the task, on its way to Windows\' console', () => {
  it('is one line with no double quote', () => {
    expect(cloudTaskText('Fix "the" bug\r\nthen\ttest  it')).toBe('Fix \'the\' bug then test it')
  })

  it('is never in the command line: cmd sees only a quoted variable', () => {
    const line = windowsCommandLine('C:\\a b\\claude.cmd', [], 'start')
    expect(line).toBe(`/d /k ""C:\\a b\\claude.cmd" --cloud "%${TASK_VARIABLE}%""`)
    expect(windowsCommandLine('C:\\a b\\claude.cmd', [], 'home')).toBe('/d /k ""C:\\a b\\claude.cmd" --teleport"')
  })
})

describe('sending a task to Claude\'s cloud', () => {
  it('opens Claude Code in a window of its own, in the folder, with the task in the variable -- & and | stay words', async () => {
    spawned.length = 0
    const cloud = createClaudeCloud({ discover: claude(), storePath: await store(), platform: 'win32', run: fakeSpawn })
    const sent = await cloud.start('C:/work/app', 'Fix the cart & run tests | report "done"', 'tm_wren')
    expect(sent.ok).toBe(true)
    expect(spawned).toHaveLength(1)
    const [call] = spawned
    expect(call!.file).toBe('cmd.exe')
    expect(call!.options).toMatchObject({ cwd: 'C:/work/app', detached: true, windowsVerbatimArguments: true })
    expect(call!.args.join(' ')).not.toContain('Fix the cart')
    expect(call!.options.env?.[TASK_VARIABLE]).toBe('Fix the cart & run tests | report \'done\'')
    // Listed for this folder only, without saying where it is.
    expect((await cloud.list('C:/work/app')).map((session) => session.prompt)).toEqual(['Fix the cart & run tests | report \'done\''])
    expect(await cloud.list('C:/elsewhere')).toEqual([])
  })

  it('brings one home with --teleport in its own folder, and forgets one on request', async () => {
    spawned.length = 0
    const cloud = createClaudeCloud({ discover: claude(), storePath: await store(), platform: 'win32', run: fakeSpawn })
    const sent = await cloud.start('C:/work/app', 'Write the docs')
    if (!sent.ok) throw new Error(sent.message)
    expect((await cloud.home(sent.session.id)).ok).toBe(true)
    expect(spawned[1]!.args[0]).toMatch(/--teleport"$/)
    expect(spawned[1]!.options.cwd).toBe('C:/work/app')
    expect(spawned[1]!.options.env?.[TASK_VARIABLE]).toBeUndefined()
    await cloud.forget(sent.session.id)
    expect(await cloud.list('C:/work/app')).toEqual([])
    expect((await cloud.home(sent.session.id)).ok).toBe(false)
  })

  it('says so, and opens nothing, when Claude Code is not installed or the task is empty', async () => {
    spawned.length = 0
    const none = createClaudeCloud({ discover: async () => [], storePath: await store(), platform: 'win32', run: fakeSpawn })
    expect(await none.start('C:/work', 'Do it')).toEqual({ ok: false, message: 'Claude Code is not installed here. Settings > AI agents shows how to add it.' })
    const cloud = createClaudeCloud({ discover: claude(), storePath: await store(), platform: 'win32', run: fakeSpawn })
    expect((await cloud.start('C:/work', '  \n ')).ok).toBe(false)
    expect(spawned).toHaveLength(0)
  })
})
