import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { ClaudeCloudSession } from '../shared/ipc.js'
import { openInMacTerminal } from './mac-terminal.js'
import { plainTerminalText } from './pseudo-terminal.js'
import type { RunInPseudoTerminal } from './pseudo-terminal.js'

/**
 * CLAUDE'S CLOUD (0.538): a task handed to a Claude Code cloud session, from
 * the same Cloud choice that sends Codex its tasks.
 *
 * MEASURED 2026-10-01/02 on Claude Code 2.1.287: `claude --cloud` refuses
 * anything but an interactive terminal ("--cloud requires an interactive
 * terminal"), a `-p` run ignores it, and there is no command that lists a
 * cloud session's state or its change. The first time in a folder it asks
 * whether the folder is trusted -- the person's question, and Locust never
 * answers it for them. `--teleport [session]` brings a cloud session home.
 *
 * So this opens Claude Code in a window of its own, in the conversation's
 * folder, with the task already given, and keeps a short list of what was
 * sent so it can be found again: on claude.ai, or brought home with
 * `--teleport`, which offers a picker when no id is given.
 *
 * 0.556, Windows: in a terminal nobody sees (pseudo-terminal.ts), so Locust
 * learns the session's id and link, and no window opens at all unless
 * Claude Code asks whether the folder is trusted -- then its window opens,
 * for the person to answer. Colin, 2026-10-02: "this dumbass window pops up,
 * makes me select a cloud folder, i do it again, try again, nothing
 * happens": that was --teleport's picker, because Locust never knew which
 * session it had sent. With the id: a follow-up goes to that session
 * (`claude -p --cloud <id> "..."`, which needs no terminal), claude.ai opens
 * on it, and --teleport is given it. MEASURED the same night: attaching to a
 * cloud session to read it is "not enabled for your account", so what the
 * session SAYS is read on claude.ai or in the Claude app, and the panel says
 * that rather than pretending to follow it.
 */

/** The task as one line Windows' console passes through untouched: no double quote, no line breaks. */
export function cloudTaskText(prompt: string): string {
  return prompt.replace(/"/g, '\'').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 4_000)
}

/** The variable the task travels in on Windows, so it is never part of the command line cmd parses. */
export const TASK_VARIABLE = 'LOCUST_CLAUDE_CLOUD_TASK'

/**
 * The argument string for `cmd.exe /k`, passed verbatim (see runtime-sign-in).
 * The task is NOT in it: `"%LOCUST_CLAUDE_CLOUD_TASK%"` is, inside quotes, so
 * `&`, `|`, `<`, `>` and `^` in what the person wrote stay words, and a value
 * is expanded once and never read again as a command. `/k` keeps the window,
 * so whatever Claude Code says on its way out can be read.
 */
export function windowsCommandLine(path: string, prefix: readonly string[], action: 'start' | 'home' | 'send', options: { readonly session?: string; readonly stay?: boolean } = {}): string {
  const head = [`"${path}"`, ...prefix.map((part) => `"${part}"`)].join(' ')
  const session = options.session !== undefined && SESSION_ID.test(options.session) ? options.session : undefined
  const tail = action === 'start'
    ? `--cloud "%${TASK_VARIABLE}%"`
    : action === 'send'
      ? `-p --cloud ${session ?? ''} "%${TASK_VARIABLE}%"`
      : session === undefined ? '--teleport' : `--teleport ${session}`
  return `/d ${options.stay === false ? '/c' : '/k'} "${head} ${tail}"`
}

/** A Claude Code cloud session's id, as it prints one. */
const SESSION_ID = /^session_[A-Za-z0-9]{8,64}$/

/** Claude Code asking the person something only they may answer: whether the folder is trusted. */
export const ASKS_THE_PERSON = 'Quick safety check|trust this folder|Do you trust'

export type CloudStartReading =
  | { readonly kind: 'created'; readonly sessionId: string; readonly url: string; readonly title?: string; readonly note?: string }
  | { readonly kind: 'asks' }
  | { readonly kind: 'failed'; readonly message?: string }

/**
 * What `claude --cloud "task"` drew, read. Measured on 2.1.288:
 *   Created cloud session: <title>
 *   View: https://claude.ai/code/session_...?from=cli&m=0
 *   Resume with: claude --teleport session_...
 *   <where it starts from: a pushed commit, or why not this branch>
 */
export function readCloudStart(drawn: string): CloudStartReading {
  const text = plainTerminalText(drawn)
  const view = /https:\/\/claude\.ai\/code\/(session_[A-Za-z0-9]{8,64})[^\s]*/.exec(text)
  if (view !== null) {
    const lines = text.split('\n')
    const title = /Created cloud session:[ \t]*(.+)/.exec(text)?.[1]?.trim()
    // What it says after "Resume with": where the session starts from.
    const resume = lines.findIndex((line) => /Resume with:/.test(line))
    const note = (resume < 0 ? [] : lines.slice(resume + 1)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 400)
    return {
      kind: 'created',
      sessionId: view[1]!,
      url: `https://claude.ai/code/${view[1]!}`,
      ...(title === undefined || title.length === 0 ? {} : { title: title.slice(0, 120) }),
      ...(note.length === 0 ? {} : { note })
    }
  }
  if (new RegExp(ASKS_THE_PERSON, 'i').test(text)) return { kind: 'asks' }
  const error = /Error:[ \t]*(.+)/.exec(text)?.[1]?.trim()
  return error === undefined ? { kind: 'failed' } : { kind: 'failed', message: error.slice(0, 300) }
}

export interface ClaudeCloudOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly storePath: string
  readonly platform?: NodeJS.Platform
  readonly run?: typeof spawn
  readonly now?: () => Date
  /** A terminal nobody sees (Windows); absent or failing, the window opens as before. */
  readonly terminal?: RunInPseudoTerminal
  /** `git status --porcelain --untracked-files=no` in a folder: undefined when it is not a git checkout. */
  readonly gitChanges?: (folder: string) => Promise<number | undefined>
  /** A command whose output is wanted (the follow-up, which needs no terminal). */
  readonly exec?: (file: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly verbatim: boolean }) => Promise<{ readonly code: number; readonly output: string }>
}

export type ClaudeCloudAnswer =
  | { readonly ok: true; readonly session: ClaudeCloudSession }
  | { readonly ok: false; readonly message: string }

const MAX_KEPT = 30

export function createClaudeCloud(options: ClaudeCloudOptions) {
  const platform = options.platform ?? process.platform
  const run = options.run ?? spawn

  const read = async (): Promise<ClaudeCloudSession[]> => {
    try {
      const parsed = JSON.parse(await readFile(options.storePath, 'utf8')) as { sessions?: unknown }
      return Array.isArray(parsed.sessions) ? parsed.sessions.filter(validSession) : []
    } catch {
      return []
    }
  }
  const write = async (sessions: readonly ClaudeCloudSession[]): Promise<void> => {
    await mkdir(join(options.storePath, '..'), { recursive: true })
    const temp = `${options.storePath}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify({ sessions }, null, 2), 'utf8')
    await rename(temp, options.storePath)
  }

  /** How Claude Code is launched here, or what to say when it cannot be. */
  const launchOf = async (): Promise<{ readonly ok: true; readonly file: string; readonly prefix: readonly string[]; readonly env: Readonly<Record<string, string>> | undefined } | { readonly ok: false; readonly message: string }> => {
    if (platform !== 'win32' && platform !== 'darwin') {
      return { ok: false, message: 'Claude\'s cloud opens from here on Windows and macOS so far. Run claude --cloud in a terminal in this folder.' }
    }
    const found = (await options.discover()).find((entry) => entry.id === 'claude')
    const launch = found?.executable
    const path = launch?.discoveredPath
    if (launch === undefined || path === undefined) {
      return { ok: false, message: 'Claude Code is not installed here. Settings > AI agents shows how to add it.' }
    }
    // Under the app's own Node (H7) the launch is the binary plus its script; otherwise the path found.
    const underOwnNode = launch.env !== undefined
    return platform === 'darwin' || underOwnNode
      ? { ok: true, file: launch.executablePath, prefix: launch.prefixArgs, env: launch.env }
      : { ok: true, file: path, prefix: [], env: launch.env }
  }

  /** Claude Code in a window of its own, in `folder`. */
  const open = async (folder: string, action: 'start' | 'home', task?: string, sessionId?: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
    const launch = await launchOf()
    if (!launch.ok) return launch
    if (platform === 'darwin') {
      const args = action === 'start' ? ['--cloud', task ?? ''] : sessionId === undefined ? ['--teleport'] : ['--teleport', sessionId]
      const opened = await openInMacTerminal(folder, { file: launch.file, args: [...launch.prefix, ...args] }, launch.env)
      return opened.ok ? { ok: true } : { ok: false, message: opened.message }
    }
    const line = windowsCommandLine(launch.file, launch.prefix, action, sessionId === undefined ? {} : { session: sessionId })
    try {
      const child = run('cmd.exe', [line], {
        cwd: folder,
        // Detached on Windows means a console of its own: the visible window.
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        windowsVerbatimArguments: true,
        env: { ...process.env, ...(launch.env ?? {}), ...(action === 'start' ? { [TASK_VARIABLE]: cloudTaskText(task ?? '') } : {}) }
      })
      child.once('error', () => undefined)
      child.unref()
      return { ok: true }
    } catch {
      return { ok: false, message: 'The window for Claude Code could not be opened. Run claude --cloud in a terminal in this folder.' }
    }
  }

  /**
   * The task sent from a terminal nobody sees (Windows): the session's id and
   * link come back. Undefined when that terminal could not run, or Claude
   * Code asked the person something -- then the window is the way.
   */
  const startUnseen = async (folder: string, task: string): Promise<CloudStartReading | undefined> => {
    if (platform !== 'win32' || options.terminal === undefined) return undefined
    const launch = await launchOf()
    if (!launch.ok) return undefined
    const drawn = await options.terminal({
      line: `cmd.exe ${windowsCommandLine(launch.file, launch.prefix, 'start', { stay: false })}`,
      cwd: folder,
      env: { ...(launch.env ?? {}), [TASK_VARIABLE]: task },
      seconds: 60,
      stopWhen: ASKS_THE_PERSON
    }).catch(() => ({ ok: false as const }))
    return drawn.ok ? readCloudStart(drawn.drawn) : undefined
  }

  return {
    async list(folder: string): Promise<readonly ClaudeCloudSession[]> {
      return (await read()).filter((session) => session.folder === folder)
    },
    async start(folder: string, prompt: string, teammateId?: string): Promise<ClaudeCloudAnswer> {
      const task = cloudTaskText(prompt)
      if (task.length === 0) return { ok: false, message: 'Describe the task first. Nothing was sent.' }
      const unseen = await startUnseen(folder, task)
      if (unseen?.kind === 'failed' && unseen.message !== undefined) {
        // Claude Code said why, in so many words: that is the answer, and nothing was created.
        return { ok: false, message: `Claude Code did not start a cloud session: ${unseen.message}` }
      }
      let asked = false
      if (unseen?.kind !== 'created') {
        // No terminal to hide in, or a question only the person answers: Claude Code's own window.
        const opened = await open(folder, 'start', task)
        if (!opened.ok) return opened
        asked = unseen?.kind === 'asks'
      }
      const session: ClaudeCloudSession = {
        id: `cc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        startedAt: (options.now?.() ?? new Date()).toISOString(),
        prompt: task.slice(0, 300),
        folder,
        ...(teammateId === undefined ? {} : { teammateId }),
        ...(unseen?.kind === 'created'
          ? { sessionId: unseen.sessionId, url: unseen.url, ...(unseen.title === undefined ? {} : { title: unseen.title }), ...(unseen.note === undefined ? {} : { note: unseen.note }) }
          : asked ? { note: 'Claude Code asks whether you trust this folder first. Answer it in the window that opened; the session starts once you do.' } : {})
      }
      await write([session, ...(await read())].slice(0, MAX_KEPT)).catch(() => undefined)
      return { ok: true, session }
    },
    /**
     * `claude --teleport <id>` in the session's folder: its work comes into
     * the folder. Claude Code refuses a folder with changes in it, so Locust
     * says so first rather than opening a window that only refuses.
     */
    async home(id: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
      const session = (await read()).find((entry) => entry.id === id)
      if (session === undefined) return { ok: false, message: 'Locust does not know that cloud session any more.' }
      const changed = await (options.gitChanges ?? gitChangesIn)(session.folder).catch(() => undefined)
      if (changed !== undefined && changed > 0) {
        return { ok: false, message: `Claude Code brings a cloud session home only into a folder with no changes, and this one has ${String(changed)} changed file${changed === 1 ? '' : 's'}. Commit or set them aside, then bring it home.` }
      }
      return open(session.folder, 'home', undefined, session.sessionId)
    },
    /** A follow-up to the session itself: `claude -p --cloud <id> "..."`, no terminal needed. */
    async send(id: string, message: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
      const session = (await read()).find((entry) => entry.id === id)
      if (session?.sessionId === undefined) return { ok: false, message: 'Locust does not know this session\'s id, so it cannot send to it. Send from claude.ai or the Claude app.' }
      const text = cloudTaskText(message)
      if (text.length === 0) return { ok: false, message: 'Write something to send first.' }
      const launch = await launchOf()
      if (!launch.ok) return launch
      const exec = options.exec ?? execOutput
      const env = { ...process.env, ...(launch.env ?? {}), [TASK_VARIABLE]: text }
      const ran = platform === 'win32'
        ? await exec('cmd.exe', [windowsCommandLine(launch.file, launch.prefix, 'send', { session: session.sessionId, stay: false })], { cwd: session.folder, env, verbatim: true })
        : await exec(launch.file, [...launch.prefix, '-p', '--cloud', session.sessionId, text], { cwd: session.folder, env, verbatim: false })
      if (ran.code === 0 && /Sent to cloud session/i.test(ran.output)) return { ok: true }
      const said = /Error:[ \t]*(.+)/.exec(plainTerminalText(ran.output))?.[1]?.trim()
      return { ok: false, message: said === undefined ? 'Claude Code did not send that. Send it from claude.ai or the Claude app.' : `Claude Code did not send that: ${said.slice(0, 300)}` }
    },
    async forget(id: string): Promise<void> {
      await write((await read()).filter((entry) => entry.id !== id)).catch(() => undefined)
    }
  }
}

export type ClaudeCloud = ReturnType<typeof createClaudeCloud>

/** Tracked files changed in `folder`; undefined when it is not a git checkout. */
async function gitChangesIn(folder: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: folder, windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      resolve(error === null ? stdout.split('\n').filter((line) => line.trim().length > 0).length : undefined)
    })
  })
}

/** A command's exit code and everything it printed. */
async function execOutput(file: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly verbatim: boolean }): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, windowsHide: true, windowsVerbatimArguments: options.verbatim, stdio: ['ignore', 'pipe', 'pipe'] })
    const guard = setTimeout(() => child.kill(), 120_000)
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('error', () => { clearTimeout(guard); resolve({ code: -1, output }) })
    child.once('close', (code) => { clearTimeout(guard); resolve({ code: code ?? -1, output }) })
  })
}

function validSession(value: unknown): value is ClaudeCloudSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && /^cc_[a-f0-9]{1,32}$/.test(record.id)
    && typeof record.startedAt === 'string' && !Number.isNaN(Date.parse(record.startedAt))
    && typeof record.prompt === 'string' && record.prompt.length <= 300
    && typeof record.folder === 'string' && record.folder.length > 0
    && (record.teammateId === undefined || typeof record.teammateId === 'string')
    && (record.sessionId === undefined || (typeof record.sessionId === 'string' && SESSION_ID.test(record.sessionId)))
    && (record.url === undefined || (typeof record.url === 'string' && record.url.startsWith('https://claude.ai/code/')))
    && (record.title === undefined || (typeof record.title === 'string' && record.title.length <= 120))
    && (record.note === undefined || (typeof record.note === 'string' && record.note.length <= 400))
}
