import { spawn } from 'node:child_process'
import { dirname, sep } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { RuntimeUpdateStatus, RuntimeUpdateView, RuntimeUpdatesState } from '../shared/ipc.js'
import { runtimeInstallFacts } from '../shared/runtime-install.js'

/**
 * KEEPING THE CODING AGENTS CURRENT.
 *
 * Colin, 2026-09-23: "new gpt-6 models released we need those added", and
 * then "is there a way to make it so the models will automatically update
 * without messing up load times or interfering with the app". The model lists
 * are already read live from each agent (model-catalog.ts); what goes stale is
 * the agent. Codex CLI 0.153.0 listed GPT-6-Astra; 0.156.1 adds GPT-6-Sol and
 * GPT-6-Luna. Claude Code, OpenCode and Cursor Agent keep themselves current;
 * Codex and Copilot, installed with npm, never do -- and Locust runs them
 * headless, so the notice Codex prints about a newer version is seen by no one.
 *
 * So, for those two:
 *
 * - LOOK, never on the way up. The first look waits until the app has been up
 *   a while (FIRST_LOOK_AFTER_MS), and again at most every CHECK_EVERY_MS. A
 *   look is one `npm view` per agent, and what it saw is kept on disk, so a
 *   launch inside that window goes to the network not at all.
 * - UPDATE ONLY WHAT NOTHING IS USING. No process may be running from the
 *   agent's own folder -- every mission Locust runs on it, and anything else
 *   on this machine that runs that copy. (The Codex app keeps a copy of its
 *   own under AppData\Local\OpenAI, and running it does not hold this one.)
 *   And only a release out for RELEASE_AGE_MS: one pulled within hours of
 *   going out never lands here.
 * - ONLY WHAT NPM PUT THERE. An agent found somewhere npm did not install it
 *   is left alone: `npm install -g` would put a second copy beside it.
 * - Then the machine is asked again and the models re-read, so the new ones
 *   are in the picker without a restart.
 *
 * A switch in Settings turns it off; off, a newer version is still reported.
 */

/**
 * Whether this launch may change the machine's agents at all. A script drives
 * the app with `--remote-debugging-port` -- more than seventy drives do, each
 * on a throwaway profile -- and a drive that updated the Codex every other
 * session on this machine runs would be a test with a side effect no one
 * asked for. `LOCUST_UPDATE_AGENTS=1` lets a drive that is about updating do
 * it (drive-agents-kept-current points npm at a folder of its own first).
 */
export function mayUpdateAgents(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  if (environment.LOCUST_UPDATE_AGENTS === '1') return true
  return !argv.some((argument) => argument.startsWith('--remote-debugging-port'))
}

/** What a saved file holds, checked field by field: anything else is nothing saved. */
export function savedUpdatesFrom(value: unknown): SavedUpdates | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const latest: Record<string, Release> = {}
  if (typeof record.latest === 'object' && record.latest !== null) {
    for (const [name, release] of Object.entries(record.latest as Record<string, unknown>)) {
      if (typeof release !== 'object' || release === null) continue
      const { version, publishedAt } = release as Record<string, unknown>
      if (typeof version === 'string') latest[name] = { version, publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined }
    }
  }
  const last: Record<string, RuntimeUpdateStatus> = {}
  if (typeof record.last === 'object' && record.last !== null) {
    for (const [runtime, status] of Object.entries(record.last as Record<string, unknown>)) {
      if (typeof status !== 'object' || status === null) continue
      const entry = status as Record<string, unknown>
      if (entry.kind === 'updated' && typeof entry.from === 'string' && typeof entry.to === 'string' && typeof entry.at === 'string') {
        last[runtime] = { kind: 'updated', from: entry.from, to: entry.to, at: entry.at }
      } else if (entry.kind === 'failed' && typeof entry.version === 'string' && typeof entry.what === 'string' && typeof entry.at === 'string') {
        last[runtime] = { kind: 'failed', version: entry.version, what: entry.what, at: entry.at }
      }
    }
  }
  return {
    enabled: record.enabled !== false,
    checkedAt: typeof record.checkedAt === 'number' && Number.isFinite(record.checkedAt) ? record.checkedAt : undefined,
    latest,
    last
  }
}

export const KEPT_CURRENT = ['codex', 'copilot'] as const
export type KeptCurrent = (typeof KEPT_CURRENT)[number]

export const FIRST_LOOK_AFTER_MS = 45_000
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
export const RELEASE_AGE_MS = 12 * 60 * 60 * 1000

export interface Release {
  readonly version: string
  /** When npm says it went out; undefined when it did not say. */
  readonly publishedAt: string | undefined
}

/** What is kept on disk between launches. */
export interface SavedUpdates {
  readonly enabled: boolean
  readonly checkedAt: number | undefined
  /** The newest release seen, by package. */
  readonly latest: Readonly<Record<string, Release>>
  /** What last happened to each agent that is worth saying again: an update, or a failed one. */
  readonly last: Readonly<Record<string, RuntimeUpdateStatus>>
}

export const NOTHING_SAVED: SavedUpdates = { enabled: true, checkedAt: undefined, latest: {}, last: {} }

/**
 * Newer, older or the same: dotted numbers compared as numbers, and a
 * prerelease below its release (`0.158.0-alpha.4` < `0.158.0`).
 */
export function compareVersions(left: string, right: string): number {
  const split = (version: string): { readonly parts: readonly number[]; readonly pre: string | undefined } => {
    const [core = '', ...rest] = version.trim().replace(/^v/i, '').split('-')
    return { parts: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre: rest.length === 0 ? undefined : rest.join('-') }
  }
  const a = split(left)
  const b = split(right)
  for (let index = 0; index < Math.max(a.parts.length, b.parts.length); index += 1) {
    const difference = (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  if (a.pre === b.pre) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  return a.pre < b.pre ? -1 : 1
}

/**
 * What to do about one agent, from what is known -- the whole rule, alone,
 * so it is tested alone.
 */
export function decide(input: {
  readonly installed: string | undefined
  readonly latest: Release | undefined
  readonly enabled: boolean
  readonly inUse: boolean
  readonly now: number
}): RuntimeUpdateStatus | { readonly kind: 'update'; readonly version: string } {
  const { installed, latest } = input
  if (installed === undefined || latest === undefined || compareVersions(latest.version, installed) <= 0) return { kind: 'current' }
  if (!input.enabled) return { kind: 'waiting', version: latest.version, why: 'off' }
  const published = latest.publishedAt === undefined ? Number.NaN : Date.parse(latest.publishedAt)
  // A release npm gives no date for is treated as brand new: it waits.
  if (!Number.isFinite(published) || input.now - published < RELEASE_AGE_MS) return { kind: 'waiting', version: latest.version, why: 'too new' }
  if (input.inUse) return { kind: 'waiting', version: latest.version, why: 'in use' }
  return { kind: 'update', version: latest.version }
}

/** Where npm keeps an agent it installed, when it did: the package's own folder. */
export function npmPackageDir(discovery: RuntimeDiscovery, npmRoot: string): string | undefined {
  const facts = runtimeInstallFacts(discovery.id)
  if (facts === undefined || facts.install.kind !== 'npm' || discovery.executable === undefined) return undefined
  const folder = [npmRoot, ...facts.install.packageName.split('/')].join(sep)
  const prefix = dirname(npmRoot)
  const executable = discovery.executable
  const same = (a: string, b: string): boolean => a.toLowerCase().replace(/[\\/]+/g, '/') === b.toLowerCase().replace(/[\\/]+/g, '/')
  const inside = (path: string, dir: string): boolean => path.toLowerCase().replace(/[\\/]+/g, '/').startsWith(`${dir.toLowerCase().replace(/[\\/]+/g, '/')}/`)
  // npm's own shim in its own prefix, or a path inside the package itself.
  const npmPut = same(dirname(executable.discoveredPath), prefix) || [executable.executablePath, ...executable.prefixArgs].some((path) => inside(path, folder))
  return npmPut ? folder : undefined
}

export interface RuntimeUpdatesOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  /** npm's global folder (`npm root -g`); undefined when there is no npm to ask. */
  readonly npmRoot: () => Promise<string | undefined>
  readonly latest: (packageName: string) => Promise<Release | undefined>
  /** Whether any process on this machine is running from inside `dir`. */
  readonly inUse: (dir: string) => Promise<boolean>
  readonly install: (runtime: string, version: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly what: string }>
  readonly load: () => Promise<SavedUpdates | undefined>
  readonly save: (saved: SavedUpdates) => Promise<void>
  /** An agent was updated: ask the machine again, re-read the models. */
  readonly updated: (runtime: string) => void
  /** Anything a window shows changed. */
  readonly changed: () => void
  readonly now?: () => number
}

export interface RuntimeUpdates {
  state(): Promise<RuntimeUpdatesState>
  setEnabled(enabled: boolean): Promise<RuntimeUpdatesState>
  /** Look, if a look is due; then update whatever is behind and not in use. */
  tick(): Promise<void>
  /** The agent being updated right now, if one is: a mission must not start on it. */
  updating(): string | undefined
}

export function createRuntimeUpdates(options: RuntimeUpdatesOptions): RuntimeUpdates {
  const now = options.now ?? Date.now
  let saved: SavedUpdates | undefined
  let current: string | undefined
  let ticking: Promise<void> | undefined
  let views: readonly RuntimeUpdateView[] = []

  const held = async (): Promise<SavedUpdates> => {
    if (saved === undefined) saved = (await options.load().catch(() => undefined)) ?? NOTHING_SAVED
    return saved
  }
  const keep = async (next: SavedUpdates): Promise<void> => {
    saved = next
    await options.save(next).catch(() => undefined)
  }

  const run = async (): Promise<void> => {
    let state = await held()
    const runtimes = await options.discover()
    const root = await options.npmRoot().catch(() => undefined)
    if (root === undefined) return
    const agents = KEPT_CURRENT.flatMap((id) => {
      const discovery = runtimes.find((entry) => entry.id === id)
      const dir = discovery === undefined ? undefined : npmPackageDir(discovery, root)
      const packageName = runtimeInstallFacts(id)?.install
      return discovery?.version !== undefined && dir !== undefined && packageName?.kind === 'npm'
        ? [{ id, installed: discovery.version.version, dir, packageName: packageName.packageName }]
        : []
    })
    // Look, if due.
    if (state.checkedAt === undefined || now() - state.checkedAt >= CHECK_EVERY_MS) {
      const latest: Record<string, Release> = { ...state.latest }
      for (const agent of agents) {
        const release = await options.latest(agent.packageName).catch(() => undefined)
        if (release !== undefined) latest[agent.packageName] = release
      }
      state = { ...state, checkedAt: now(), latest }
      await keep(state)
    }
    const next: RuntimeUpdateView[] = []
    for (const agent of agents) {
      const release = state.latest[agent.packageName]
      const ask = (inUse: boolean): ReturnType<typeof decide> =>
        decide({ installed: agent.installed, latest: release, enabled: state.enabled, inUse, now: now() })
      // The machine's process table is read only when it is the last question:
      // an update would go ahead if nothing were using the agent.
      const provisional = ask(false)
      const verdict = provisional.kind === 'update' ? ask(await options.inUse(agent.dir).catch(() => true)) : provisional
      if (verdict.kind !== 'update') {
        // A past update is still worth saying until something newer is out.
        const last = state.last[agent.id]
        next.push({ runtime: agent.id, installed: agent.installed, latest: release?.version, status: verdict.kind === 'current' && last !== undefined ? last : verdict })
        continue
      }
      current = agent.id
      next.push({ runtime: agent.id, installed: agent.installed, latest: verdict.version, status: { kind: 'updating', version: verdict.version } })
      views = [...next]
      options.changed()
      const outcome = await options.install(agent.id, verdict.version).catch((error: unknown) => ({ ok: false as const, what: error instanceof Error ? error.message : String(error) }))
      current = undefined
      const at = new Date(now()).toISOString()
      const status: RuntimeUpdateStatus = outcome.ok
        ? { kind: 'updated', from: agent.installed, to: verdict.version, at }
        : { kind: 'failed', version: verdict.version, what: outcome.what, at }
      state = { ...state, last: { ...state.last, [agent.id]: status } }
      await keep(state)
      next[next.length - 1] = { runtime: agent.id, installed: outcome.ok ? verdict.version : agent.installed, latest: verdict.version, status }
      if (outcome.ok) options.updated(agent.id)
    }
    views = next
    options.changed()
  }

  return {
    async state() {
      const state = await held()
      return { enabled: state.enabled, checkedAt: state.checkedAt === undefined ? undefined : new Date(state.checkedAt).toISOString(), agents: views }
    },
    async setEnabled(enabled) {
      await keep({ ...(await held()), enabled })
      // Turned on, whatever was waiting on it goes now, not at the next look.
      if (enabled) void this.tick()
      return this.state()
    },
    tick() {
      if (ticking !== undefined) return ticking
      ticking = run().finally(() => {
        ticking = undefined
      })
      return ticking
    },
    updating: () => current
  }
}

/** One command, no shell, its output, and a time limit. */
function capture(command: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, shell: false })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${command} took longer than ${String(timeoutMs / 1000)} s`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < 4_000_000) out += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${command} exited ${String(code)}`))
    })
  })
}

/**
 * What npm says the newest release of a package is, and when it went out.
 * `npm` on Windows is a .cmd, which only a shell runs: it goes through
 * cmd.exe with fixed, quoted arguments -- a package name from the facts table,
 * never anything typed.
 */
export async function npmRelease(packageName: string): Promise<Release | undefined> {
  const args = ['view', packageName, 'dist-tags.latest', 'time', '--json']
  const text = process.platform === 'win32'
    ? await capture(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], 60_000)
    : await capture('npm', args, 60_000)
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const version = record['dist-tags.latest']
  if (typeof version !== 'string' || version.length === 0) return undefined
  const times = record.time
  const publishedAt = typeof times === 'object' && times !== null ? (times as Record<string, unknown>)[version] : undefined
  return { version, publishedAt: typeof publishedAt === 'string' ? publishedAt : undefined }
}

/** npm's global folder, where `npm install -g` puts packages. */
export async function npmGlobalRoot(): Promise<string | undefined> {
  const text = process.platform === 'win32'
    ? await capture(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm root -g'], 30_000)
    : await capture('npm', ['root', '-g'], 30_000)
  const root = text.trim().split(/\r?\n/).pop()?.trim()
  return root === undefined || root.length === 0 ? undefined : root
}

/**
 * Whether any process on this machine is running from inside `dir`: its
 * executable there, or -- for an agent that is a node script -- that script
 * on its command line. Read from Windows' own process table.
 */
export async function processesUsing(dir: string): Promise<boolean> {
  const needle = dir.toLowerCase().replace(/[\\/]+/g, '\\')
  if (process.platform !== 'win32') {
    const text = await capture('ps', ['-eo', 'command'], 20_000)
    return text.toLowerCase().includes(dir.toLowerCase())
  }
  const text = await capture(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ExecutablePath)|$($_.CommandLine)" }'],
    30_000
  )
  return text.toLowerCase().replace(/[\\/]+/g, '\\').includes(needle)
}
