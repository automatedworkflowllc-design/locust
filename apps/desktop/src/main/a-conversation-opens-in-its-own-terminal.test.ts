import { EventEmitter } from 'node:events'

import type { ExecutableLaunch } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import {
  consoleLine,
  isResumableSessionId,
  openInTerminal,
  resumeArgsFor,
  terminalProgram,
  terminalRequestFor,
  windowsTerminalArgs
} from './open-in-terminal.js'
import type { TerminalFacts, TerminalRequest } from './open-in-terminal.js'

/**
 * A CONVERSATION OPENS IN ITS OWN TERMINAL (0.387).
 *
 * Colin, 2026-09-26: "we can either ship it in the three dot dropdown or have
 * it more visible, or do like a coding terminal button". The same session, in
 * the runtime's own interface, in the teammate's folder -- and nothing but
 * the runtime's resume flag and a checked session id reaches the terminal.
 */

const node = (script: string): ExecutableLaunch => ({
  commandName: 'codex',
  discoveredPath: 'C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\codex.cmd',
  executablePath: 'C:\\Program Files\\nodejs\\node.exe',
  prefixArgs: [script],
  kind: 'node-shim'
})
const CODEX = node('C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js')
const CLAUDE: ExecutableLaunch = {
  commandName: 'claude',
  discoveredPath: 'C:\\npm\\claude.exe',
  executablePath: 'C:\\npm\\claude.exe',
  prefixArgs: [],
  kind: 'native'
}
const CURSOR: ExecutableLaunch = {
  commandName: 'cursor-agent',
  discoveredPath: 'C:\\Users\\Jane Doe\\AppData\\Local\\cursor-agent\\cursor-agent.cmd',
  executablePath: 'C:\\Windows\\System32\\cmd.exe',
  prefixArgs: ['/d', '/s', '/c', 'C:\\Users\\Jane Doe\\AppData\\Local\\cursor-agent\\cursor-agent.cmd'],
  kind: 'cmd-shim'
}

describe('the words that resume a session, read off each CLI’s own --help on 2026-09-26', () => {
  const id = '28232cc1-50b4-4789-9d84-c756818e8eec'
  it('are each runtime’s own flag', () => {
    expect(resumeArgsFor('codex', id)).toEqual(['resume', id])
    expect(resumeArgsFor('claude', id)).toEqual(['--resume', id])
    expect(resumeArgsFor('copilot', id)).toEqual([`--resume=${id}`])
    expect(resumeArgsFor('cursor', id)).toEqual([`--resume=${id}`])
    expect(resumeArgsFor('opencode', 'ses_3f1a9c')).toEqual(['--session', 'ses_3f1a9c'])
    expect(resumeArgsFor('muse', id)).toEqual(['resume', id])
  })

  it('do not exist for an app with a window of its own, or a runtime that does not run here', () => {
    expect(resumeArgsFor('antigravity', id)).toBeUndefined()
    expect(resumeArgsFor('gemini', id)).toBeUndefined()
    expect(resumeArgsFor('omniroute', id)).toBeUndefined()
  })

  it('take a session id only when it is a plain token: never an option, never a shell word', () => {
    for (const good of [id, 'ses_3f1a9c', 'my-session.2', 'a:b']) expect(isResumableSessionId(good), good).toBe(true)
    for (const bad of ['', '-rf', '--resume', 'a b', 'a;b', 'a&b', 'a|b', '"a"', '%PATH%', '^a', 'a\nb', 'x'.repeat(201)]) {
      expect(isResumableSessionId(bad), bad).toBe(false)
      expect(resumeArgsFor('claude', bad), bad).toBeUndefined()
    }
  })
})

describe('the program a terminal starts', () => {
  it('is the Node script, the native binary, or the .cmd launcher itself -- never cmd wrapping cmd', () => {
    expect(terminalProgram(CODEX, ['resume', 'abc'])).toEqual({ file: CODEX.executablePath, args: [CODEX.prefixArgs[0], 'resume', 'abc'] })
    expect(terminalProgram(CLAUDE, ['--resume', 'abc'])).toEqual({ file: CLAUDE.executablePath, args: ['--resume', 'abc'] })
    expect(terminalProgram(CURSOR, ['--resume=abc'])).toEqual({ file: CURSOR.prefixArgs[3], args: ['--resume=abc'] })
  })

  it('goes to Windows Terminal as a new window titled for the conversation, in the teammate’s folder', () => {
    const program = terminalProgram(CLAUDE, ['--resume', 'abc'])
    expect(windowsTerminalArgs(program, 'C:\\work\\wren', 'Wren · Claude Code')).toEqual([
      '-w', 'new', 'new-tab', '--title', 'Wren · Claude Code', '-d', 'C:\\work\\wren', CLAUDE.executablePath, '--resume', 'abc'
    ])
  })

  it('does not go to Windows Terminal with a ";" anywhere in it: wt splits its own commands there', () => {
    const program = terminalProgram(CLAUDE, ['--resume', 'abc'])
    expect(windowsTerminalArgs(program, 'C:\\a;b', 'Wren · Claude Code')).toBeUndefined()
    expect(windowsTerminalArgs(program, 'C:\\work', 'Wren; Pip')).toBeUndefined()
  })

  it('in a console window, is one cmd line with every path quoted, the way the sign-in window does it', () => {
    const resume = ['resume', 'abc']
    expect(consoleLine(terminalProgram(CODEX, resume), resume)).toBe(`/d /k ""${CODEX.executablePath}" "${CODEX.prefixArgs[0]}" resume abc"`)
    expect(consoleLine(terminalProgram(CURSOR, ['--resume=abc']), ['--resume=abc'])).toBe(`/d /k ""${CURSOR.prefixArgs[3]}" --resume=abc"`)
  })
})

/** A spawn that records what it was asked, and starts or fails as told. */
function fakeSpawn(outcomes: readonly ('start' | 'fail')[]): { spawn: never; calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] } {
  const calls: { file: string; args: readonly string[]; options: Record<string, unknown> }[] = []
  let index = 0
  const spawn = (file: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options })
    const child = Object.assign(new EventEmitter(), { unref: () => undefined })
    const outcome = outcomes[index] ?? 'fail'
    index += 1
    queueMicrotask(() => (outcome === 'start' ? child.emit('spawn') : child.emit('error', new Error('spawn wt.exe ENOENT'))))
    return child
  }
  return { spawn: spawn as never, calls }
}

const REQUEST: TerminalRequest = { runtime: 'claude', sessionId: 'abc-123', cwd: 'C:\\work\\wren', launch: CLAUDE, title: 'Wren · Claude Code' }

describe('opening it', () => {
  it('starts Windows Terminal when it is there, detached, and says so', async () => {
    const fake = fakeSpawn(['start'])
    const answer = await openInTerminal(REQUEST, { platform: 'win32', spawn: fake.spawn, localAppData: 'C:\\Users\\J\\AppData\\Local' })
    expect(answer).toEqual({ ok: true, where: 'Windows Terminal' })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.file).toBe('C:\\Users\\J\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe')
    expect(fake.calls[0]!.options.detached).toBe(true)
  })

  it('falls back to a console window of its own when Windows Terminal will not start', async () => {
    const fake = fakeSpawn(['fail', 'start'])
    const answer = await openInTerminal(REQUEST, { platform: 'win32', spawn: fake.spawn })
    expect(answer).toEqual({ ok: true, where: 'a console window' })
    expect(fake.calls[1]).toMatchObject({ file: 'cmd.exe', options: { cwd: 'C:\\work\\wren', detached: true, windowsVerbatimArguments: true, windowsHide: false } })
    expect(fake.calls[1]!.args).toEqual(['/d /k ""C:\\npm\\claude.exe" --resume abc-123"'])
  })

  it('goes straight to the console window for a CLI run under Locust’s own Node, with its environment', async () => {
    const fake = fakeSpawn(['start'])
    const ownNode: ExecutableLaunch = { ...CODEX, executablePath: 'C:\\Program Files\\Locust\\Locust.exe', env: { ELECTRON_RUN_AS_NODE: '1' } }
    const answer = await openInTerminal({ ...REQUEST, runtime: 'codex', launch: ownNode }, { platform: 'win32', spawn: fake.spawn })
    expect(answer).toEqual({ ok: true, where: 'a console window' })
    expect(fake.calls[0]!.file).toBe('cmd.exe')
    expect((fake.calls[0]!.options.env as Record<string, string>).ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('starts nothing for a session id that is not a plain token, or off Windows', async () => {
    const fake = fakeSpawn(['start', 'start'])
    expect((await openInTerminal({ ...REQUEST, sessionId: 'a & calc' }, { platform: 'win32', spawn: fake.spawn })).ok).toBe(false)
    expect((await openInTerminal(REQUEST, { platform: 'darwin', spawn: fake.spawn })).ok).toBe(false)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('which conversation, and where', () => {
  const facts = (over: Partial<TerminalFacts> = {}): TerminalFacts => ({
    liveMissionIds: () => [],
    getMission: async () => ({ runtime: 'claude', model: 'opus', session: 'abc-123' }),
    ownerOf: async () => ({ teammateId: 'tm_wren', name: 'Wren' }),
    cwdFor: async () => 'C:\\work\\wren-worktree',
    workspacePath: 'C:\\work',
    launchFor: async () => CLAUDE,
    ...over
  })

  it('is the mission’s own session, in its teammate’s folder, titled for them', async () => {
    expect(await terminalRequestFor('m1', facts())).toEqual({ runtime: 'claude', sessionId: 'abc-123', cwd: 'C:\\work\\wren-worktree', launch: CLAUDE, title: 'Wren · Claude Code' })
    // Nobody's conversation, or a teammate with no folder of its own: the project folder.
    expect(await terminalRequestFor('m1', facts({ ownerOf: async () => undefined }))).toMatchObject({ cwd: 'C:\\work', title: 'Locust · Claude Code' })
    expect(await terminalRequestFor('m1', facts({ cwdFor: async () => undefined }))).toMatchObject({ cwd: 'C:\\work' })
  })

  it('is refused while the run is going, and says why', async () => {
    expect(await terminalRequestFor('m1', facts({ liveMissionIds: () => ['m1'] }))).toMatchObject({ refused: expect.stringContaining('still running') })
  })

  it('is refused, with the reason, for Antigravity, a model of your own, a turn with no session, and a CLI not found', async () => {
    expect(await terminalRequestFor('m1', facts({ getMission: async () => ({ runtime: 'antigravity', model: 'flash', session: 'c1' }) }))).toMatchObject({ refused: expect.stringContaining("Antigravity's own window") })
    expect(await terminalRequestFor('m1', facts({ getMission: async () => ({ runtime: 'opencode', model: 'own-1a2b3c4d/acme-70b', session: 'ses_1' }) }))).toMatchObject({ refused: expect.stringContaining('model of your own') })
    expect(await terminalRequestFor('m1', facts({ getMission: async () => ({ runtime: 'claude', model: 'opus', session: undefined }) }))).toMatchObject({ refused: expect.stringContaining('no Claude Code session') })
    expect(await terminalRequestFor('m1', facts({ launchFor: async () => undefined }))).toMatchObject({ refused: expect.stringContaining('could not find Claude Code') })
    expect(await terminalRequestFor('m1', facts({ getMission: async () => undefined }))).toMatchObject({ refused: expect.stringContaining('not in the ledger') })
  })
})
