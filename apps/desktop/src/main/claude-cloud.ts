import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { ClaudeCloudReading, ClaudeCloudSession } from '../shared/ipc.js'
import { openInMacTerminal } from './mac-terminal.js'
import { plainTerminalText } from './pseudo-terminal.js'
import type { RunInPseudoTerminal } from './pseudo-terminal.js'
import { sessionExchanges } from './session-import.js'
import type { TerminalExchange } from './terminal-catch-up.js'
import { isResumableSessionId, openInTerminal } from './open-in-terminal.js'
import type { TerminalRequest } from './open-in-terminal.js'
import type { OpenInTerminalResponse } from '../shared/ipc.js'

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
export function windowsCommandLine(path: string, prefix: readonly string[], action: 'start' | 'home' | 'send' | 'read', options: { readonly session?: string; readonly stay?: boolean; readonly choice?: CloudChoice; readonly worktree?: string } = {}): string {
  const head = [`"${path}"`, ...prefix.map((part) => `"${part}"`)].join(' ')
  const session = options.session !== undefined && SESSION_ID.test(options.session) ? options.session : undefined
  const worktree = options.worktree !== undefined && /^locust-cloud-[a-f0-9]{1,12}$/.test(options.worktree) ? options.worktree : undefined
  const tail = action === 'start'
    ? [...choiceArgs(options.choice), '--cloud', `"%${TASK_VARIABLE}%"`].join(' ')
    : action === 'send'
      ? `-p --cloud ${session ?? ''} --output-format json "%${TASK_VARIABLE}%"`
      : action === 'read'
        ? `--teleport ${session ?? ''} --worktree ${worktree ?? ''}`
        : session === undefined ? '--teleport' : `--teleport ${session}`
  return `/d ${options.stay === false ? '/c' : '/k'} "${head} ${tail}"`
}

/**
 * The model and effort picked in the box, for the session (0.557). Colin,
 * 2026-10-02: "you're sending all these cloud messages on opus 5.5" -- and
 * his own test on Sonnet Low went the same way: `--cloud` was given no model,
 * so every session ran on the account's default. Measured: `--model haiku
 * --cloud "..."` is accepted. Only a plain name or level is passed, never
 * anything cmd could read as more.
 */
export interface CloudChoice {
  readonly model?: string
  readonly effort?: string
}
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,79}$/
const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function choiceArgs(choice: CloudChoice | undefined): string[] {
  const model = choice?.model !== undefined && choice.model !== 'account-default' && MODEL_NAME.test(choice.model) ? choice.model : undefined
  const effort = choice?.effort !== undefined && EFFORTS.includes(choice.effort) ? choice.effort : undefined
  return [...(model === undefined ? [] : ['--model', model]), ...(effort === undefined ? [] : ['--effort', effort])]
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

/**
 * Where Claude Code keeps a folder's transcripts: `projects/` and the folder's
 * path with every other character a dash (measured: `C:\...\.claude\worktrees\x`
 * is `C--...--claude-worktrees-x`).
 */
export function transcriptFolderOf(claudeHome: string, folder: string): string {
  return join(claudeHome, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'))
}

/** The worktree a session is read into, by Locust's own id for it: never a name the person chose. */
export function readingWorktreeName(id: string): string {
  return `locust-cloud-${id.replace(/^cc_/, '').slice(0, 12)}`
}

export type CloudReadingProblem = 'asks' | 'long-paths' | undefined

/** What `claude --teleport <id> --worktree <name>` drew, for what only the person can do about it. */
export function readTeleport(drawn: string): { readonly problem: CloudReadingProblem; readonly noBranch: boolean; readonly error?: string } {
  const text = plainTerminalText(drawn)
  const error = /Error:[ \t]*(.+)/.exec(text)?.[1]?.trim().slice(0, 300)
  return {
    problem: new RegExp(ASKS_THE_PERSON, 'i').test(text) ? 'asks' : /Filename too long/i.test(text) ? 'long-paths' : undefined,
    // Measured 10/02: a session that changed nothing pushed no branch, and Claude Code says so.
    noBranch: /resumed without branch|Failed to checkout branch/i.test(text),
    ...(error === undefined ? {} : { error })
  }
}

/** Every Claude Code variable that would mark the run as Claude Code's own child, and so stop it saving its transcript. */
function withoutClaudeMarkers(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  // Measured 10/02: with any of them left (CLAUDE_PID too), the transcript folder was made and left empty.
  for (const key of Object.keys(env)) if (/^CLAUDE/i.test(key) && !/^CLAUDE_CONFIG_DIR$/i.test(key)) out[key] = undefined
  return out
}

export type GitRun = (args: readonly string[], cwd: string, input?: string) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>

/** The bound on a change Locust reads into the panel. */
const MAX_DIFF = 4 * 1024 * 1024
const MAX_EXCHANGES = 40

export interface ClaudeCloudOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly storePath: string
  readonly platform?: NodeJS.Platform
  readonly run?: typeof spawn
  readonly now?: () => Date
  /** A terminal nobody sees (Windows); absent or failing, the window opens as before. */
  readonly terminal?: RunInPseudoTerminal
  /** `git status --porcelain` in a folder, untracked files counted as Claude Code counts them (measured 10/02: 128 "changed", nearly all untracked): undefined when it is not a git checkout. */
  readonly gitChanges?: (folder: string) => Promise<number | undefined>
  /** A command whose output is wanted (the follow-up, which needs no terminal). */
  readonly exec?: (file: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly verbatim: boolean }) => Promise<{ readonly code: number; readonly output: string; readonly stdout?: string }>
  /** Where Claude Code keeps its transcripts (`projects/`). */
  readonly claudeHome?: string
  readonly git?: GitRun
  /** A transcript's exchanges (session-import's reader). */
  readonly exchangesOf?: (path: string) => Promise<readonly TerminalExchange[]>
  /** W5: tested without opening a real terminal or running Claude. */
  readonly openTerminal?: (request: TerminalRequest) => Promise<OpenInTerminalResponse>
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
  const open = async (folder: string, action: 'start' | 'home', task?: string, sessionId?: string, choice?: CloudChoice): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
    const launch = await launchOf()
    if (!launch.ok) return launch
    if (platform === 'darwin') {
      const args = action === 'start' ? [...choiceArgs(choice), '--cloud', task ?? ''] : sessionId === undefined ? ['--teleport'] : ['--teleport', sessionId]
      const opened = await openInMacTerminal(folder, { file: launch.file, args: [...launch.prefix, ...args] }, launch.env)
      return opened.ok ? { ok: true } : { ok: false, message: opened.message }
    }
    const line = windowsCommandLine(launch.file, launch.prefix, action, { ...(sessionId === undefined ? {} : { session: sessionId }), ...(choice === undefined ? {} : { choice }) })
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
  const startUnseen = async (folder: string, task: string, choice: CloudChoice | undefined): Promise<CloudStartReading | undefined> => {
    if (platform !== 'win32' || options.terminal === undefined) return undefined
    const launch = await launchOf()
    if (!launch.ok) return undefined
    const drawn = await options.terminal({
      line: `cmd.exe ${windowsCommandLine(launch.file, launch.prefix, 'start', { stay: false, ...(choice === undefined ? {} : { choice }) })}`,
      cwd: folder,
      env: { ...(launch.env ?? {}), [TASK_VARIABLE]: task },
      seconds: 60,
      stopWhen: ASKS_THE_PERSON
    }).catch(() => ({ ok: false as const }))
    return drawn.ok ? readCloudStart(drawn.drawn) : undefined
  }

  const git = options.git ?? gitRun
  const claudeHome = options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const exchangesOf = options.exchangesOf ?? ((path: string) => sessionExchanges('claude', path))

  /**
   * Where `--worktree <name>` puts the session: `.claude/worktrees/<name>` in
   * the repository's main checkout (measured 10/02: from a linked worktree it
   * landed beside git's common directory, not in the folder itself).
   */
  const worktreeOf = async (folder: string, name: string): Promise<string | undefined> => {
    const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], folder).catch(() => undefined)
    if (common === undefined || common.code !== 0) return undefined
    const dir = common.stdout.trim()
    if (dir.length === 0) return undefined
    return join(dirname(isAbsolute(dir) ? dir : resolvePath(folder, dir)), '.claude', 'worktrees', name)
  }
  /** The reading's worktree and its branch, gone. Claude Code locks the worktrees it makes, hence the second --force. */
  const removeReading = async (folder: string, name: string): Promise<void> => {
    const where = await worktreeOf(folder, name)
    if (where === undefined) return
    await git(['worktree', 'remove', '--force', '--force', where], folder).catch(() => undefined)
    await git(['worktree', 'prune'], folder).catch(() => undefined)
    await git(['branch', '-D', `worktree-${name}`], folder).catch(() => undefined)
  }
  /** The transcript Claude Code wrote for the worktree, the newest since `since`. */
  const transcriptFor = async (name: string, since: number): Promise<string | undefined> => {
    const projects = join(claudeHome, 'projects')
    let best: { readonly path: string; readonly at: number } | undefined
    for (const dir of await readdir(projects).catch(() => [] as string[])) {
      // The folder's path, every other character a dash: `...--claude-worktrees-<name>`.
      if (!dir.endsWith(`-claude-worktrees-${name}`)) continue
      for (const file of await readdir(join(projects, dir)).catch(() => [] as string[])) {
        if (!file.endsWith('.jsonl')) continue
        const path = join(projects, dir, file)
        const at = (await stat(path).catch(() => undefined))?.mtimeMs
        if (at !== undefined && at >= since - 5_000 && (best === undefined || at > best.at)) best = { path, at }
      }
    }
    return best?.path
  }
  /** What the session's branch changed, from where it parted from the folder's commit. Undefined: nothing. */
  const changeIn = async (where: string, folder: string): Promise<string | undefined> => {
    const head = await git(['rev-parse', 'HEAD'], folder)
    if (head.code !== 0) return undefined
    const base = await git(['merge-base', 'HEAD', head.stdout.trim()], where)
    if (base.code !== 0) return undefined
    const diff = await git(['diff', '--binary', base.stdout.trim(), 'HEAD'], where)
    return diff.code === 0 && diff.stdout.trim().length > 0 ? diff.stdout : undefined
  }

  const checks = new Map<string, Promise<ClaudeCloudReading>>()
  return {
    /**
     * WHAT THE SESSION DID, READ HERE (0.558). Colin, 2026-10-02: "why cant we
     * make this work for the user? ... exhaust all possibilities". Attaching
     * is refused for the account, but `claude --teleport <id> --worktree
     * <name>` fetches the session's whole conversation and checks out its
     * branch in a worktree of its own -- the folder itself untouched. Run in a
     * terminal nobody sees; once Claude Code's prompt is up, it is ended, and
     * the transcript it saved is read as an imported session is. Its change
     * is the branch against the folder's commit, kept until Apply or Forget.
     * Every check is a fresh teleport; nothing polls. It makes no model call.
     */
    async check(id: string): Promise<ClaudeCloudReading> {
      const current = checks.get(id)
      if (current !== undefined) return current
      const pending = (async (): Promise<ClaudeCloudReading> => {
        const session = (await read()).find((entry) => entry.id === id)
        if (session === undefined) return { ok: false, message: 'Locust does not know that cloud session any more.' }
        if (session.sessionId === undefined) return { ok: false, message: 'Locust does not know this session’s id, so it cannot read it here. See it on claude.ai.' }
        if (platform !== 'win32' || options.terminal === undefined) return { ok: false, message: 'Reading a cloud session here works on Windows so far. See it on claude.ai, or bring it home.' }
        const launch = await launchOf()
        if (!launch.ok) return launch
        const name = readingWorktreeName(session.id)
        const where = await worktreeOf(session.folder, name)
        if (where === undefined) return { ok: false, message: 'This folder is not a git checkout, so Claude Code cannot bring the session into it. See it on claude.ai.' }
        await removeReading(session.folder, name)
        const began = Date.now()
        const drawn = await options.terminal({
          line: `cmd.exe ${windowsCommandLine(launch.file, launch.prefix, 'read', { session: session.sessionId, stay: false, worktree: name })}`,
          cwd: session.folder,
          // Run from inside Claude Code (a drive, a teammate), its markers would turn transcript saving off.
          env: { ...withoutClaudeMarkers(process.env), ...(launch.env ?? {}) },
          seconds: 120,
          stopWhen: `${ASKS_THE_PERSON}|Filename too long`,
          // Done when its transcript is written: measured 10/02, that comes a few seconds AFTER it says
          // "Session resumed", and ending it at the words left none. Its prompt footer comes earlier still.
          stopWhenWritten: transcriptFolderOf(claudeHome, where)
        }).catch(() => ({ ok: false as const }))
        if (!drawn.ok) return { ok: false, message: 'Claude Code could not be run to read it. See it on claude.ai.' }
        const said = readTeleport(drawn.drawn)
        if (said.problem !== undefined) {
          await removeReading(session.folder, name)
          return said.problem === 'asks'
            ? { ok: false, message: 'Claude Code asks whether you trust this folder first. Open Claude Code in this folder once and answer it, then check again.' }
            : { ok: false, message: 'Git could not check the session out here: some of its paths are longer than Windows allows. Turning on long paths for this repository fixes it: git config core.longpaths true' }
        }
        let path: string | undefined
        for (let tries = 0; tries < 10 && path === undefined; tries += 1) {
          path = await transcriptFor(name, began)
          if (path === undefined) await new Promise((done) => setTimeout(done, 500))
        }
        // Measured 10/02: in two runs of six the session came in (its branch checked out) but no
        // transcript was saved within two minutes, for no reason it drew. Its change is still shown.
        const home = await stat(where).then((found) => found.isDirectory(), () => false)
        if (path === undefined && !home) {
          await removeReading(session.folder, name)
          return { ok: false, message: said.error === undefined ? 'Claude Code did not bring the session in. See it on claude.ai.' : `Claude Code did not bring the session in: ${said.error}` }
        }
        const exchanges = (path === undefined ? [] as readonly TerminalExchange[] : await exchangesOf(path).catch(() => [] as readonly TerminalExchange[])).slice(-MAX_EXCHANGES).map((exchange) => ({
          prompt: exchange.prompt.slice(0, 4_000),
          ...(exchange.answer === undefined ? {} : { answer: exchange.answer.slice(0, 16_000) }),
          at: exchange.finishedAt,
          ...(exchange.model === undefined ? {} : { model: exchange.model })
        }))
        const change = said.noBranch ? undefined : await changeIn(where, session.folder).catch(() => undefined)
        const checkedAt = (options.now?.() ?? new Date()).toISOString()
        return {
          ok: true,
          exchanges,
          checkedAt,
          ...(change === undefined ? {} : change.length > MAX_DIFF ? { changeTooBig: true } : { diff: change }),
          ...(said.noBranch
            ? { note: 'Claude Code could not check out its branch, so there is no change to show here. A session that changed nothing has none.' }
            : path === undefined ? { note: 'Claude Code brought it in but did not save its conversation this time. Check again to read it.' } : {})
        }
      })()
      checks.set(id, pending)
      try { return await pending }
      finally { checks.delete(id) }
    },
    /** The change last read comes into the folder, not committed; the reading's worktree goes. */
    async apply(id: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
      const session = (await read()).find((entry) => entry.id === id)
      if (session === undefined) return { ok: false, message: 'Locust does not know that cloud session any more.' }
      const name = readingWorktreeName(session.id)
      const where = await worktreeOf(session.folder, name)
      const there = where !== undefined && (await stat(where).then((found) => found.isDirectory(), () => false))
      if (!there) return { ok: false, message: 'Check it again first: Locust no longer has its change.' }
      const change = await changeIn(where, session.folder).catch(() => undefined)
      if (change === undefined) return { ok: false, message: 'It has no change to bring in.' }
      // `git apply` changes nothing unless every file applies.
      const applied = await git(['apply', '--whitespace=nowarn', '-'], session.folder, change)
      if (applied.code !== 0) {
        const why = applied.stderr.split('\n').find((line) => line.trim().length > 0)?.replace(/^error:\s*/, '').trim()
        return { ok: false, message: `Its change does not apply cleanly to this folder${why === undefined ? '' : ` (${why.slice(0, 200)})`}. Nothing was changed.` }
      }
      await removeReading(session.folder, name)
      return { ok: true }
    },
    async list(folder: string): Promise<readonly ClaudeCloudSession[]> {
      return (await read()).filter((session) => session.folder === folder)
    },
    /** W5: the terminal gets its own copy; Locust never watches its work. */
    async continueInTerminal(id: string): Promise<OpenInTerminalResponse> {
      const session = (await read()).find((entry) => entry.id === id)
      if (session?.sessionId === undefined || !isResumableSessionId(session.sessionId)) {
        return { ok: false, message: 'Locust does not know a valid id for this cloud session. Open it on claude.ai.' }
      }
      if (platform !== 'win32' && platform !== 'darwin') return { ok: false, message: 'Continue in terminal works on Windows and macOS so far. Open it on claude.ai.' }
      const launch = (await options.discover()).find((entry) => entry.id === 'claude')?.executable
      if (launch === undefined) return { ok: false, message: 'Claude Code is not installed here. Settings > AI agents shows how to add it.' }
      const where = await worktreeOf(session.folder, `${readingWorktreeName(session.id)}-here`)
      if (where === undefined) return { ok: false, message: 'This folder is not a git checkout. Open this session on claude.ai.' }
      // A fresh, detached checkout, never a reading's worktree or the person's folder.
      const made = await git(['worktree', 'add', '--detach', where, 'HEAD'], session.folder).catch(() => undefined)
      if (made?.code !== 0) return { ok: false, message: 'The terminal worktree could not be created. An earlier copy may still be open; finish there or open the session on claude.ai.' }
      const opened = await (options.openTerminal ?? ((request) => openInTerminal(request, { platform, spawn: run })))({
        runtime: 'claude', sessionId: session.sessionId, cwd: where, launch,
        title: 'Locust · Claude cloud', cloudSession: true
      }).catch(() => ({ ok: false as const, message: 'The terminal could not be opened. Open this session on claude.ai.' }))
      if (!opened.ok) await git(['worktree', 'remove', where], session.folder).catch(() => undefined)
      return opened
    },
    async start(folder: string, prompt: string, teammateId?: string, choice?: CloudChoice): Promise<ClaudeCloudAnswer> {
      const task = cloudTaskText(prompt)
      if (task.length === 0) return { ok: false, message: 'Describe the task first. Nothing was sent.' }
      const unseen = await startUnseen(folder, task, choice)
      if (unseen?.kind === 'failed' && unseen.message !== undefined) {
        // Claude Code said why, in so many words: that is the answer, and nothing was created.
        return { ok: false, message: `Claude Code did not start a cloud session: ${unseen.message}` }
      }
      let asked = false
      if (unseen?.kind !== 'created') {
        // No terminal to hide in, or a question only the person answers: Claude Code's own window.
        const opened = await open(folder, 'start', task, undefined, choice)
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
        : await exec(launch.file, [...launch.prefix, '-p', '--cloud', session.sessionId, '--output-format', 'json', text], { cwd: session.folder, env, verbatim: false })
      // W3: the documented receipt on stdout confirms the send; stderr and terminal prose do not.
      let receipt: Record<string, unknown> | undefined
      for (const line of (ran.stdout ?? ran.output).trim().split(/\r?\n/).reverse()) {
        try {
          const value: unknown = JSON.parse(line)
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) { receipt = value as Record<string, unknown>; break }
        } catch { /* A diagnostic line is not a send receipt. */ }
      }
      if (receipt?.ok === false && typeof receipt.error === 'string') return { ok: false, message: receipt.error }
      if (ran.code === 0 && receipt?.ok === true && receipt.session_id === session.sessionId) return { ok: true }
      const said = /Error:[ \t]*(.+)/.exec(plainTerminalText(ran.output))?.[1]?.trim()
      return { ok: false, message: said === undefined ? 'Claude Code did not send that. Send it from claude.ai or the Claude app.' : `Claude Code did not send that: ${said.slice(0, 300)}` }
    },
    async forget(id: string): Promise<void> {
      const sessions = await read()
      const session = sessions.find((entry) => entry.id === id)
      if (session?.sessionId !== undefined) await removeReading(session.folder, readingWorktreeName(session.id)).catch(() => undefined)
      await write(sessions.filter((entry) => entry.id !== id)).catch(() => undefined)
    }
  }
}

export type ClaudeCloud = ReturnType<typeof createClaudeCloud>

/** Files changed or untracked in `folder` (teleport refuses either); undefined when it is not a git checkout. */
async function gitChangesIn(folder: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['status', '--porcelain'], { cwd: folder, windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      resolve(error === null ? stdout.split('\n').filter((line) => line.trim().length > 0).length : undefined)
    })
  })
}

/** git, its output apart, with what it reads on stdin. */
const gitRun: GitRun = (args, cwd, input) => new Promise((resolve) => {
  let stdout = ''
  let stderr = ''
  const child = spawn('git', [...args], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const guard = setTimeout(() => child.kill(), 120_000)
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.stdin.on('error', () => undefined)
  child.stdin.end(input ?? '')
  child.once('error', () => { clearTimeout(guard); resolve({ code: -1, stdout, stderr }) })
  child.once('close', (code) => { clearTimeout(guard); resolve({ code: code ?? -1, stdout, stderr }) })
})

/** A command's exit code and everything it printed. */
async function execOutput(file: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly verbatim: boolean }): Promise<{ readonly code: number; readonly output: string; readonly stdout: string }> {
  return new Promise((resolve) => {
    let output = ''
    let stdout = ''
    const child = spawn(file, [...args], { cwd: options.cwd, env: options.env, windowsHide: true, windowsVerbatimArguments: options.verbatim, stdio: ['ignore', 'pipe', 'pipe'] })
    const guard = setTimeout(() => child.kill(), 120_000)
    child.stdout.on('data', (chunk: Buffer) => { const text = chunk.toString('utf8'); output += text; stdout += text })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.once('error', () => { clearTimeout(guard); resolve({ code: -1, output, stdout }) })
    child.once('close', (code) => { clearTimeout(guard); resolve({ code: code ?? -1, output, stdout }) })
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
