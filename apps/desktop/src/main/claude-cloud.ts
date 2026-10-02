import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { ClaudeCloudSession } from '../shared/ipc.js'
import { openInMacTerminal } from './mac-terminal.js'

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
export function windowsCommandLine(path: string, prefix: readonly string[], action: 'start' | 'home'): string {
  const head = [`"${path}"`, ...prefix.map((part) => `"${part}"`)].join(' ')
  const tail = action === 'start' ? `--cloud "%${TASK_VARIABLE}%"` : '--teleport'
  return `/d /k "${head} ${tail}"`
}

export interface ClaudeCloudOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly storePath: string
  readonly platform?: NodeJS.Platform
  readonly run?: typeof spawn
  readonly now?: () => Date
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

  /** Claude Code in a window of its own, in `folder`. */
  const open = async (folder: string, action: 'start' | 'home', task?: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
    if (platform !== 'win32' && platform !== 'darwin') {
      return { ok: false, message: 'Claude\'s cloud opens from here on Windows and macOS so far. Run claude --cloud in a terminal in this folder.' }
    }
    const found = (await options.discover()).find((entry) => entry.id === 'claude')
    const launch = found?.executable
    const path = launch?.discoveredPath
    if (launch === undefined || path === undefined) {
      return { ok: false, message: 'Claude Code is not installed here. Settings > AI agents shows how to add it.' }
    }
    const args = action === 'start' ? ['--cloud', task ?? ''] : ['--teleport']
    if (platform === 'darwin') {
      const opened = await openInMacTerminal(folder, { file: launch.executablePath, args: [...launch.prefixArgs, ...args] }, launch.env)
      return opened.ok ? { ok: true } : { ok: false, message: opened.message }
    }
    // Under the app's own Node (H7) the launch is the binary plus its script; otherwise the path found.
    const underOwnNode = launch.env !== undefined
    const line = underOwnNode ? windowsCommandLine(launch.executablePath, launch.prefixArgs, action) : windowsCommandLine(path, [], action)
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

  return {
    async list(folder: string): Promise<readonly ClaudeCloudSession[]> {
      return (await read()).filter((session) => session.folder === folder)
    },
    async start(folder: string, prompt: string, teammateId?: string): Promise<ClaudeCloudAnswer> {
      const task = cloudTaskText(prompt)
      if (task.length === 0) return { ok: false, message: 'Describe the task first. Nothing was sent.' }
      const opened = await open(folder, 'start', task)
      if (!opened.ok) return opened
      const session: ClaudeCloudSession = {
        id: `cc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        startedAt: (options.now?.() ?? new Date()).toISOString(),
        prompt: task.slice(0, 300),
        folder,
        ...(teammateId === undefined ? {} : { teammateId })
      }
      await write([session, ...(await read())].slice(0, MAX_KEPT)).catch(() => undefined)
      return { ok: true, session }
    },
    /** `claude --teleport` in the session's folder: its picker lists the cloud sessions to bring home. */
    async home(id: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
      const session = (await read()).find((entry) => entry.id === id)
      if (session === undefined) return { ok: false, message: 'Locust does not know that cloud session any more.' }
      return open(session.folder, 'home')
    },
    async forget(id: string): Promise<void> {
      await write((await read()).filter((entry) => entry.id !== id)).catch(() => undefined)
    }
  }
}

export type ClaudeCloud = ReturnType<typeof createClaudeCloud>

function validSession(value: unknown): value is ClaudeCloudSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && /^cc_[a-f0-9]{1,32}$/.test(record.id)
    && typeof record.startedAt === 'string' && !Number.isNaN(Date.parse(record.startedAt))
    && typeof record.prompt === 'string' && record.prompt.length <= 300
    && typeof record.folder === 'string' && record.folder.length > 0
    && (record.teammateId === undefined || typeof record.teammateId === 'string')
}
