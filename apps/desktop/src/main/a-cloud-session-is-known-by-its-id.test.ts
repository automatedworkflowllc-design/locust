import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ASKS_THE_PERSON, TASK_VARIABLE, createClaudeCloud, readCloudStart, windowsCommandLine } from './claude-cloud.js'
import type { PseudoTerminalRun } from './pseudo-terminal.js'
import { plainTerminalText } from './pseudo-terminal.js'

/**
 * A CLOUD SESSION IS KNOWN BY ITS ID (0.556).
 *
 * Colin, 2026-10-02: "this dumbass window pops up, makes me select a cloud
 * folder, i do it again, try again, nothing happens". Locust opened a window
 * for `claude --cloud` and learned nothing back, so "Bring it home" could
 * only offer --teleport's picker. Started in a terminal nobody sees, Claude
 * Code prints the session's id and link: Locust keeps them, opens no
 * window, links to the session itself, sends follow-ups to it, and brings it
 * home by name. A question only the person answers -- whether the folder is
 * trusted -- still opens Claude Code's window, and nothing answers it.
 */

// What Claude Code 2.1.288 drew under a pseudo console, 2026-10-02, verbatim.
const CREATED = "\u001b[2J\u001b[m\u001b[H\u001b]0;C:\\Windows\\SYSTEM32\\cmd.exe\u0007\u001b[?25h\u001b]0;claude\u0007\u001b[?2004h\u001b[?2031h\u001b[?1004h\u001b[?9001l\u001b[<u\u001b[>5u\u001b[>4;2m\u001b[?25l\u001b]11;?\u0007\u001b[>0q\u001b[?u\u001b[>4m\u001b[<u\u001b[?1004l\u001b[?2031l\u001b[?2004lCreated cloud session: Session confirmation\u001b[?1016l\u001b[>4m\u001b[?1004l\u001b[?2031l\u001b[?2004l\u001b[<u\r\nView: https://claude.ai/code/session_01Jed6HzK3Np9xeyKnSQ7oBG?from=cli&m=0\u001b[49X\r\nResume with: claude --teleport session_01Jed6HzK3Np9xeyKnSQ7oBG\u001b[60X\r\nThis checkout is on a detached HEAD, so the cloud session starts from its own commit, which origin/main has (da8b7798a7a7).\r\n\u000f\u001b[122X\u001b]0;\u0007\u001b[?25h"
const TRUST = "\u001b[2J\u001b[m\u001b[H\u001b]0;C:\\Windows\\SYSTEM32\\cmd.exe\u0007\u001b[?25h\u001b]0;claude\u0007\u001b[?2004h\u001b[?2031h\u001b[?1004h\u001b[?9001l\u001b[<u\u001b[>5u\u001b[>4;2m\u001b[?25l\u001b[?2026h\u001b]8;id=zaxmda;https://code.claude.com/docs/en/security\u0007\u001b]8;;\u0007\u001b[?2026l\u001b]11;?\u0007\u001b[>0q\u001b[?u\r\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\r\n Accessing workspace:\u001b[K\r\n\u001b[K\r\n C:\\Users\\<home>\\Documents\\locust-scratch\\cloud-untrusted\u001b[K\r\n\u001b[K\r\n Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from    \r\n your team). If not, take a moment to review what's in this folder first.\u001b[K\r\n\u001b[K\r\n Claude Code'll be able to read, edit, and execute files here.\u001b[K\r\n\u001b[K\r\n Security guide\u001b[K\r\n\u001b[K\r\n \u276f No, exit\u001b[K\r\n   Yes, I trust this folder\u001b[K\r\n\u001b[K\r\n Enter to confirm \u00b7 Esc to cancel\u001b[K\u001b[107C\u001b[?1004l\u001b[>4m\u001b[<u\u001b[?2031l\u001b[?2004l\u001b[?1016l\r\n\u000f\u001b]0;\u0007\u001b[?25h"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const store = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-claude-cloud-id-'))
  roots.push(root)
  return join(root, 'claude-cloud.json')
}
const claude = async () => [{
  id: 'claude',
  executable: { discoveredPath: 'C:\\npm\\claude.cmd', executablePath: 'C:\\npm\\claude.cmd', prefixArgs: [] as string[] }
}] as never
const windows: { args: readonly string[]; options: { cwd?: string } }[] = []
const fakeSpawn = ((_file: string, args: readonly string[], options: never) => {
  windows.push({ args, options })
  return { once: () => undefined, unref: () => undefined }
}) as never
const terminalDrawing = (drawn: string) => {
  const runs: PseudoTerminalRun[] = []
  return { runs, terminal: async (run: PseudoTerminalRun) => { runs.push(run); return { ok: true as const, drawn } } }
}

describe('what Claude Code says when it starts a cloud session', () => {
  it('is read for the id, the link, the title and where it starts from', () => {
    const read = readCloudStart(CREATED)
    expect(read).toEqual({
      kind: 'created',
      sessionId: 'session_01Jed6HzK3Np9xeyKnSQ7oBG',
      url: 'https://claude.ai/code/session_01Jed6HzK3Np9xeyKnSQ7oBG',
      title: 'Session confirmation',
      note: 'This checkout is on a detached HEAD, so the cloud session starts from its own commit, which origin/main has (da8b7798a7a7).'
    })
  })

  it('knows the trust question for what it is', () => {
    expect(readCloudStart(TRUST)).toEqual({ kind: 'asks' })
    expect(new RegExp(ASKS_THE_PERSON, 'i').test(plainTerminalText(TRUST))).toBe(true)
  })

  it('passes on what Claude Code said when it refused', () => {
    expect(readCloudStart('\u001b[2JError: --cloud requires a description.\r\n')).toEqual({ kind: 'failed', message: '--cloud requires a description.' })
  })
})

describe('starting one out of sight', () => {
  it('opens no window, keeps the id, and never puts the task on the command line', async () => {
    windows.length = 0
    const { runs, terminal } = terminalDrawing(CREATED)
    const cloud = createClaudeCloud({ discover: claude, storePath: await store(), platform: 'win32', run: fakeSpawn, terminal })
    const sent = await cloud.start('C:/work/app', 'Fix the cart & run tests | report')
    if (!sent.ok) throw new Error(sent.message)
    expect(windows).toHaveLength(0)
    expect(sent.session).toMatchObject({ sessionId: 'session_01Jed6HzK3Np9xeyKnSQ7oBG', url: 'https://claude.ai/code/session_01Jed6HzK3Np9xeyKnSQ7oBG', title: 'Session confirmation' })
    expect(runs[0]!.line).not.toContain('Fix the cart')
    expect(runs[0]!.line).toContain(`--cloud "%${TASK_VARIABLE}%"`)
    expect(runs[0]!.env[TASK_VARIABLE]).toBe('Fix the cart & run tests | report')
    expect(runs[0]!.cwd).toBe('C:/work/app')
    expect(runs[0]!.stopWhen).toBe(ASKS_THE_PERSON)
    expect((await cloud.list('C:/work/app'))[0]?.sessionId).toBe('session_01Jed6HzK3Np9xeyKnSQ7oBG')
  })

  it('opens Claude Code\'s window when it asks whether the folder is trusted, and says why', async () => {
    windows.length = 0
    const { terminal } = terminalDrawing(TRUST)
    const cloud = createClaudeCloud({ discover: claude, storePath: await store(), platform: 'win32', run: fakeSpawn, terminal })
    const sent = await cloud.start('C:/work/new', 'Write the docs')
    if (!sent.ok) throw new Error(sent.message)
    expect(windows).toHaveLength(1)
    expect(windows[0]!.args[0]).toContain('--cloud')
    expect(sent.session.sessionId).toBeUndefined()
    expect(sent.session.note).toMatch(/trust this folder/)
  })

  it('refuses, opening and keeping nothing, when Claude Code says no', async () => {
    windows.length = 0
    const { terminal } = terminalDrawing('Error: Unable to create cloud session\r\n')
    const cloud = createClaudeCloud({ discover: claude, storePath: await store(), platform: 'win32', run: fakeSpawn, terminal })
    expect(await cloud.start('C:/work/app', 'Do it')).toEqual({ ok: false, message: 'Claude Code did not start a cloud session: Unable to create cloud session' })
    expect(windows).toHaveLength(0)
    expect(await cloud.list('C:/work/app')).toEqual([])
  })

  it('falls back to the window when the hidden terminal cannot run', async () => {
    windows.length = 0
    const cloud = createClaudeCloud({ discover: claude, storePath: await store(), platform: 'win32', run: fakeSpawn, terminal: async () => ({ ok: false }) })
    expect((await cloud.start('C:/work/app', 'Do it')).ok).toBe(true)
    expect(windows).toHaveLength(1)
  })
})

describe('a session Locust knows', () => {
  const known = async (gitChanges?: number) => {
    windows.length = 0
    const execs: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    let reply = { code: 0, output: 'Sent to cloud session.\nSession ID: session_01Jed6HzK3Np9xeyKnSQ7oBG\n' }
    const cloud = createClaudeCloud({
      discover: claude, storePath: await store(), platform: 'win32', run: fakeSpawn, terminal: terminalDrawing(CREATED).terminal,
      gitChanges: async () => gitChanges,
      exec: async (file, args, options) => { execs.push({ file, args, env: options.env }); return reply }
    })
    const sent = await cloud.start('C:/work/app', 'Fix it')
    if (!sent.ok) throw new Error(sent.message)
    return { cloud, id: sent.session.id, execs, answer: (next: typeof reply) => { reply = next } }
  }

  it('is brought home by its id, with no picker', async () => {
    const { cloud, id } = await known(0)
    expect((await cloud.home(id)).ok).toBe(true)
    expect(windows[0]!.args[0]).toMatch(/--teleport session_01Jed6HzK3Np9xeyKnSQ7oBG"$/)
  })

  it('is not brought home into a folder with changes: it says so and opens nothing', async () => {
    const { cloud, id } = await known(2)
    const home = await cloud.home(id)
    expect(home.ok).toBe(false)
    expect(home.ok ? '' : home.message).toMatch(/2 changed files/)
    expect(windows).toHaveLength(0)
  })

  it('takes a follow-up, the words in a variable and never on the command line', async () => {
    const { cloud, id, execs } = await known(0)
    expect(await cloud.send(id, 'Also run the tests & report')).toEqual({ ok: true })
    expect(execs[0]!.file).toBe('cmd.exe')
    expect(execs[0]!.args[0]).toBe(`/d /c ""C:\\npm\\claude.cmd" -p --cloud session_01Jed6HzK3Np9xeyKnSQ7oBG "%${TASK_VARIABLE}%""`)
    expect(execs[0]!.env[TASK_VARIABLE]).toBe('Also run the tests & report')
  })

  it('says what Claude Code said when a follow-up does not go', async () => {
    const { cloud, id, answer } = await known(0)
    answer({ code: 1, output: 'Error: failed to send message to cloud session: Session not found\n' })
    expect(await cloud.send(id, 'More')).toEqual({ ok: false, message: 'Claude Code did not send that: failed to send message to cloud session: Session not found' })
  })
})

describe('the command line', () => {
  it('carries a session id only when it is one: anything else is never passed to cmd', () => {
    expect(windowsCommandLine('C:\\c.cmd', [], 'home', { session: 'session_01Jed6HzK3Np9xeyKnSQ7oBG' })).toBe('/d /k ""C:\\c.cmd" --teleport session_01Jed6HzK3Np9xeyKnSQ7oBG"')
    expect(windowsCommandLine('C:\\c.cmd', [], 'home', { session: 'session_1 & calc' })).toBe('/d /k ""C:\\c.cmd" --teleport"')
  })
})
