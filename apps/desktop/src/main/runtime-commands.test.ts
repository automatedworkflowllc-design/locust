import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { commandNamed, createRuntimeCommands, HIDDEN_COMMANDS } from './runtime-commands.js'

/**
 * EACH RUNTIME'S OWN SLASH COMMANDS (0.426).
 *
 * Colin, 2026-09-28: "Lots of the nerdier coders live by their commands and
 * if they can't access them or see them in the same way they can in claude
 * code/codex etc. it may be a turn off for them."
 */
const COMPACT = { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' }
const CONTEXT = { name: 'context', description: 'Show current context usage', argumentHint: '' }
const MODEL = { name: 'model', description: 'Set the AI model for Claude Code', argumentHint: '[model]' }
const MCP = { name: 'mcp', description: 'Manage MCP servers', argumentHint: '' }

describe('the command a message names', () => {
  it('is the word after a leading slash', () => {
    expect(commandNamed('/compact')).toBe('compact')
    expect(commandNamed('  /compact keep the test names')).toBe('compact')
    expect(commandNamed('/security-review')).toBe('security-review')
    expect(commandNamed('/plugin:skill now')).toBe('plugin:skill')
  })

  it('is nothing when the slash is not at the start, or is not followed by a name', () => {
    expect(commandNamed('please /compact')).toBeUndefined()
    expect(commandNamed('/')).toBeUndefined()
    expect(commandNamed('/src/main/index.ts is broken')).toBeUndefined()
    expect(commandNamed('compact')).toBeUndefined()
  })
})

describe('the commands a runtime listed', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-runtime-commands-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('are offered without the ones that would change the person\'s own setup', async () => {
    const commands = createRuntimeCommands({ file: join(folder, 'runtime-commands.json') })
    expect(await commands.set('claude', [COMPACT, MODEL, CONTEXT, MCP])).toBe(true)
    // model is the teammate's, chosen in Locust; mcp would rewrite the person's settings.
    expect(HIDDEN_COMMANDS.claude?.has('model')).toBe(true)
    expect(await commands.list()).toEqual({ claude: [COMPACT, CONTEXT] })
  })

  it('say a message is a command only for the runtime that listed it, and never a hidden one', async () => {
    const commands = createRuntimeCommands({ file: join(folder, 'runtime-commands.json') })
    await commands.set('claude', [COMPACT, MODEL, CONTEXT])
    expect(commands.isCommand('claude', '/compact')).toBe(true)
    expect(commands.isCommand('claude', '/compact keep the test names')).toBe(true)
    expect(commands.isCommand('claude', '/model opus')).toBe(false)
    expect(commands.isCommand('claude', '/nonsense')).toBe(false)
    expect(commands.isCommand('claude', 'please /compact')).toBe(false)
    expect(commands.isCommand('codex', '/compact')).toBe(false)
    expect(commands.isCommand(undefined, '/compact')).toBe(false)
  })

  it("are kept per runtime: OpenCode's beside Claude Code's, none of OpenCode's hidden (0.427)", async () => {
    const file = join(folder, 'runtime-commands.json')
    const commands = createRuntimeCommands({ file })
    const INIT = { name: 'init', description: 'guided AGENTS.md setup', argumentHint: '[arguments]' }
    await commands.set('claude', [COMPACT, MODEL])
    await commands.set('opencode', [INIT])
    expect(await commands.list()).toEqual({ claude: [COMPACT], opencode: [INIT] })
    expect(commands.isCommand('opencode', '/init keep it short')).toBe(true)
    expect(commands.isCommand('opencode', '/compact')).toBe(false)
    expect(commands.isCommand('claude', '/init')).toBe(false)
    expect(await createRuntimeCommands({ file }).list()).toEqual({ claude: [COMPACT], opencode: [INIT] })
  })

  it('are kept across a restart, and a list that did not change is not written again', async () => {
    const file = join(folder, 'runtime-commands.json')
    const first = createRuntimeCommands({ file })
    await first.set('claude', [COMPACT, CONTEXT])
    expect(await first.set('claude', [COMPACT, CONTEXT])).toBe(false)
    const again = createRuntimeCommands({ file })
    expect(await again.list()).toEqual({ claude: [COMPACT, CONTEXT] })
    // Read at once, so the first message of a session is recognised.
    expect(again.isCommand('claude', '/context')).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('are nothing, not an error, before any run listed them or when the file is unreadable', async () => {
    expect(await createRuntimeCommands({ file: join(folder, 'none.json') }).list()).toEqual({})
    const broken = join(folder, 'broken.json')
    await writeFile(broken, '{ not json', 'utf8')
    const commands = createRuntimeCommands({ file: broken })
    expect(await commands.list()).toEqual({})
    expect(commands.isCommand('claude', '/compact')).toBe(false)
  })
})
