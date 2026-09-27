import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { parseAntigravityProjects, projectIdForWorkspace } from '@teammate/runtime-adapters'

import { ANTIGRAVITY_TIER_NAMES } from '../shared/antigravity-models.js'

/**
 * Antigravity, EXPERIMENTAL.
 *
 * Google's Antigravity IDE runs its own agent inside a folder it has open. It
 * has no supported automation surface; what it has is `language_server.exe
 * agentapi`, a tiny CLI meant for its own sub-agents, which starts a
 * conversation and sends messages into one. Everything below was measured on
 * 2026-09-03 against Antigravity 2.11.0 and is reverse-engineered:
 *
 * - the server the CLI talks to is the running `language_server.exe` that
 *   Antigravity itself launched; its CSRF token is on that process's command
 *   line and its port is whichever of the process's listening ports answers
 *   an RPC (one of the two measured ports refuses with a connection error);
 * - `new-conversation` needs a PROJECT id for the workspace, which lives in a
 *   protobuf file with no schema (`agyhub_summaries_proto.pb`);
 * - the agent's work is then observable in a JSONL transcript per
 *   conversation, which the mission service polls.
 *
 * So this route only works while Antigravity is open, only for a folder it
 * has open, and it cannot be held read-only: Antigravity's agent runs its
 * own tools under its own policy. All of that is said in the UI, by name.
 */

export interface AntigravityHost {
  readonly executablePath: string
  readonly version: string | undefined
  readonly address: string
  readonly csrfToken: string
  readonly projects: ReadonlyMap<string, string>
  /**
   * Every port the server listens on. The CLI's is `address`; a question is
   * answered over the plain-HTTP one of the two (antigravity-cascade.ts).
   */
  readonly ports?: readonly number[]
}

export interface AntigravityProbeOptions {
  readonly localAppData?: string
  readonly home?: string
  readonly platform?: NodeJS.Platform
  /**
   * Test seam: the pids of every `language_server.exe`, as `tasklist`
   * reports them in tens of milliseconds -- or `undefined` when it could not
   * say, which falls through to the PowerShell path below.
   */
  readonly listPids?: () => Promise<readonly number[] | undefined>
  /** Test seam: the process list as `Win32_Process` reports it. */
  readonly listProcesses?: () => Promise<readonly { readonly pid: number; readonly commandLine: string }[]>
  /** Test seam: listening TCP ports of a process. */
  readonly listeningPorts?: (pid: number) => Promise<readonly number[]>
  /** Test seam: the clock, so a test can step past the TTL. */
  readonly now?: () => number
  /** Test seam: run the CLI once. */
  readonly run?: (executable: string, args: readonly string[], env: Readonly<Record<string, string>>) => Promise<{ stdout: string; stderr: string; code: number | null }>
}

// Named from the one table the window reads too (shared/antigravity-models.ts).
export const ANTIGRAVITY_MODELS = [
  { id: 'flash', displayName: ANTIGRAVITY_TIER_NAMES.flash!, description: 'Antigravity tier flash' },
  { id: 'pro', displayName: ANTIGRAVITY_TIER_NAMES.pro!, description: 'Antigravity tier pro' },
  { id: 'flash_lite', displayName: ANTIGRAVITY_TIER_NAMES.flash_lite!, description: 'Antigravity tier flash_lite' }
] as const

const PROBE_TTL_MS = 10_000

export function antigravityExecutableCandidates(localAppData: string): readonly string[] {
  return [
    join(localAppData, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
    join(localAppData, 'Programs', 'Antigravity', 'resources', 'bin', 'language_server.exe')
  ]
}

export function antigravityDataDirectory(home: string): string {
  return join(home, '.gemini', 'antigravity')
}

export function transcriptPathFor(home: string, conversationId: string): string {
  return join(antigravityDataDirectory(home), 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl')
}

/** The CSRF token and version Antigravity put on its own server's command line. */
export function parseServerCommandLine(commandLine: string): { readonly csrfToken: string; readonly version: string | undefined } | undefined {
  if (!/--override_ide_name antigravity\b/.test(commandLine)) return undefined
  const token = /--csrf_token\s+([0-9a-f-]{36})/i.exec(commandLine)?.[1]
  if (token === undefined) return undefined
  const version = /--override_ide_version\s+(\S+)/.exec(commandLine)?.[1]
  return { csrfToken: token, version }
}

function runCli(
  executable: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      { env: { ...process.env, ...env }, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : null
        resolve({ stdout: String(stdout), stderr: String(stderr), code })
      }
    )
  })
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (_error, stdout) => resolve(String(stdout))
    )
  })
}

async function listProcessesWindows(): Promise<readonly { readonly pid: number; readonly commandLine: string }[]> {
  // Filtered by WMI itself, not piped through Where-Object: measured 328 ms
  // against 392 ms for the same answer (2026-09-22).
  const out = await powershell(
    "Get-CimInstance Win32_Process -Filter \"Name LIKE 'language_server%'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
  )
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t')
      return { pid: Number(line.slice(0, tab)), commandLine: line.slice(tab + 1) }
    })
    .filter((entry) => Number.isFinite(entry.pid))
}

/**
 * The ports a process listens on, from `netstat -ano`.
 *
 * It was `Get-NetTCPConnection`, which loads a PowerShell module before it
 * answers: 724 ms measured on Colin's machine (2026-09-22), the largest part
 * of Antigravity's 1.7 s check on every launch. `netstat -ano -p TCP` says
 * the same in 48 ms.
 *
 * Read by SHAPE, not by word: netstat translates its state column ("LISTENING"
 * is "ABHÖREN" in German), so a listening socket is told by its empty remote
 * end -- `0.0.0.0:0`, or `[::]:0` -- which every locale prints the same.
 */
export function listeningPortsIn(netstat: string, pid: number): readonly number[] {
  const ports = new Set<number>()
  for (const line of netstat.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 5 || !/^tcp/i.test(columns[0] ?? '')) continue
    if (Number(columns[columns.length - 1]) !== pid) continue
    const remote = columns[2] ?? ''
    if (!/^(0\.0\.0\.0|\[::\]):0$/.test(remote)) continue
    const local = columns[1] ?? ''
    const port = Number(local.slice(local.lastIndexOf(':') + 1))
    if (Number.isInteger(port) && port > 0) ports.add(port)
  }
  return [...ports]
}

function listeningPortsWindows(pid: number): Promise<readonly number[]> {
  return new Promise((resolve) => {
    execFile('netstat.exe', ['-ano', '-p', 'TCP'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (_error, stdout) =>
      resolve(listeningPortsIn(String(stdout), pid))
    )
  })
}

/**
 * Every `language_server.exe` pid, from `tasklist` -- tens of milliseconds
 * where each PowerShell start is one to three seconds cold. `undefined` when
 * tasklist itself failed, so the caller falls back rather than concluding
 * "not open" from a tool that did not answer.
 */
function listLanguageServerPidsWindows(): Promise<readonly number[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq language_server.exe', '/FO', 'CSV', '/NH'],
      { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined)
          return
        }
        // `"language_server.exe","12345","Console","1","123,456 K"`; with no
        // match tasklist prints an INFO sentence instead of a CSV row.
        const pids = String(stdout)
          .split(/\r?\n/)
          .map((line) => /^"language_server\.exe","(\d+)"/i.exec(line.trim())?.[1])
          .filter((pid): pid is string => pid !== undefined)
          .map((pid) => Number(pid))
        resolve(pids)
      }
    )
  })
}

const samePids = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && [...left].sort((a, b) => a - b).every((pid, index) => pid === [...right].sort((a, b) => a - b)[index])

export function createAntigravityHostProbe(options: AntigravityProbeOptions = {}): {
  probe(): Promise<AntigravityHost | undefined>
  discoveryRecord(): Promise<RuntimeDiscovery>
} {
  const platform = options.platform ?? process.platform
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? ''
  const home = options.home ?? homedir()
  const listPids = options.listPids ?? listLanguageServerPidsWindows
  const listProcesses = options.listProcesses ?? listProcessesWindows
  const listeningPorts = options.listeningPorts ?? listeningPortsWindows
  const run = options.run ?? runCli
  const now = options.now ?? Date.now
  let cached: { readonly at: number; readonly value: AntigravityHost | undefined; readonly pids: readonly number[] | undefined } | undefined

  /*
   * `LOCUST_HIDE_RUNTIMES=1` HAS TO REACH THIS PROBE TOO.
   *
   * The seam exists so `_tools/drive-first-run.mjs` can see what a person
   * with an empty laptop sees, on a machine that has all six agents. It works
   * by handing discovery an executable locator that finds nothing -- and this
   * probe does not use that locator. It looks for Antigravity's own install
   * directly with `existsSync`, so it stayed READY through every "bare
   * machine" drive.
   *
   * MEASURED 2026-09-21, driving 0.244.0: `drive-first-run.mjs` exited on
   * *"the composer is on Antigravity / Account Default"*, which is neither a
   * bare machine nor a free route. So the one tool whose whole job is the
   * first-run screen has not been driving the first-run screen since
   * Antigravity shipped -- and that screen is where eight of the nine
   * findings in Sol's beta review were, found on a separate Linux box
   * because this seam could not show them here.
   *
   * Read from `options` first so the unit tests keep their own seam, and the
   * environment only decides when nothing else has.
   */
  // Read at ASK time, not at construction: a probe built during module load
  // would latch whatever the environment said before the drive set it.
  const hidden = (): boolean => options.localAppData === undefined && process.env.LOCUST_HIDE_RUNTIMES === '1'

  const probe = async (): Promise<AntigravityHost | undefined> => {
    if (hidden()) return undefined
    if (cached !== undefined && now() - cached.at < PROBE_TTL_MS) return cached.value
    if (platform !== 'win32') return undefined
    const executablePath = antigravityExecutableCandidates(localAppData).find((candidate) => existsSync(candidate))
    if (executablePath === undefined) return undefined
    /*
     * The cheap question first: is a language server running at all, and is
     * it the same one as last time?
     *
     * Two PowerShell round trips per sweep -- `Get-CimInstance Win32_Process`
     * and `Get-NetTCPConnection` -- were 4.2-5.5 s of every sweep on Colin's
     * machine (2026-09-21), for an answer that only changes when Antigravity
     * opens or closes. `tasklist` says in tens of milliseconds whether any
     * `language_server.exe` exists; the same pids as the last full look mean
     * the same server, the same port and the same token, so the last answer
     * stands. PowerShell runs only when the set of processes has changed.
     * (Fable's probing review, #7.)
     */
    const pids = await listPids()
    if (pids !== undefined) {
      if (pids.length === 0) {
        cached = { at: now(), value: undefined, pids }
        return undefined
      }
      if (cached?.value !== undefined && cached.pids !== undefined && samePids(cached.pids, pids)) {
        cached = { ...cached, at: now() }
        return cached.value
      }
    }
    const value = await (async () => {
      const servers = (await listProcesses())
        .map((entry) => ({ pid: entry.pid, parsed: parseServerCommandLine(entry.commandLine) }))
        .filter((entry): entry is { pid: number; parsed: NonNullable<ReturnType<typeof parseServerCommandLine>> } => entry.parsed !== undefined)
      for (const server of servers) {
        const ports = await listeningPorts(server.pid)
        /*
         * Every port asked AT ONCE, and the first that answers in port order
         * wins -- the same answer the one-at-a-time loop gave. The language
         * server listens on two here, and the loop paid a CLI start for the
         * wrong one before it tried the right one (2026-09-22).
         */
        const answers = await Promise.all(
          ports.map((port) =>
            // A probe that cannot succeed: the one thing it proves is whether
            // this port speaks the RPC at all. The wrong port answers with a
            // connection error; the right one with a clean "not found".
            run(executablePath, ['agentapi', 'get-conversation-metadata', '00000000-0000-0000-0000-000000000000'], {
              ANTIGRAVITY_LS_ADDRESS: `localhost:${String(port)}`,
              ANTIGRAVITY_CSRF_TOKEN: server.parsed.csrfToken
            })
          )
        )
        for (const [index, port] of ports.entries()) {
          const address = `localhost:${String(port)}`
          const result = answers[index]
          if (result === undefined) continue
          const text = `${result.stdout}\n${result.stderr}`
          if (/connection error|wsarecv|is not set/i.test(text)) continue
          let projects: ReadonlyMap<string, string> = new Map()
          try {
            projects = parseAntigravityProjects(readFileSync(join(antigravityDataDirectory(home), 'agyhub_summaries_proto.pb')))
          } catch {
            projects = new Map()
          }
          return { executablePath, version: server.parsed.version, address, csrfToken: server.parsed.csrfToken, projects, ports }
        }
      }
      return undefined
    })()
    cached = { at: now(), value, pids }
    return value
  }

  return {
    probe,
    async discoveryRecord(): Promise<RuntimeDiscovery> {
      const installed = !hidden() && platform === 'win32' && antigravityExecutableCandidates(localAppData).some((candidate) => existsSync(candidate))
      const host = installed ? await probe() : undefined
      const base = {
        id: 'antigravity' as const,
        kind: 'agent-runtime' as const,
        displayName: 'Antigravity',
        optional: true,
        supportedFeatures: [],
        requiredFeatures: [],
        modelHints: { aliases: [], efforts: [], models: [...ANTIGRAVITY_MODELS] }
      }
      if (!installed) {
        return {
          ...base,
          availability: 'unavailable',
          readiness: 'unknown',
          diagnostics: [
            { code: 'executable-not-found', severity: 'info', message: 'Antigravity is not installed on this machine.' }
          ]
        }
      }
      if (host === undefined) {
        return {
          ...base,
          availability: 'available',
          readiness: 'unhealthy',
          diagnostics: [
            {
              code: 'readiness-unverifiable',
              severity: 'warning',
              message: 'Antigravity is installed but not open. This route drives the agent inside the running app.',
              resolution: 'Open Antigravity with the workspace folder, then retry discovery.'
            }
          ]
        }
      }
      return {
        ...base,
        availability: 'available',
        readiness: 'ready',
        executable: { commandName: 'language_server', discoveredPath: host.executablePath, executablePath: host.executablePath, prefixArgs: ['agentapi'], kind: 'native' },
        ...(host.version === undefined ? {} : { version: parseVersion(host.version) }),
        diagnostics: [
          {
            code: 'readiness-unverifiable',
            severity: 'info',
            message: `Experimental: runs Antigravity's own agent in a folder Antigravity has open (${String(host.projects.size)} known). It cannot be held read-only.`
          }
        ]
      }
    }
  }
}

function parseVersion(raw: string): RuntimeDiscovery['version'] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw)
  if (match === null) return undefined
  return { raw, version: match[0], major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export interface AgentApi {
  newConversation(input: { readonly projectId: string; readonly model: string; readonly title: string; readonly prompt: string }): Promise<string>
  sendMessage(input: { readonly projectId: string; readonly conversationId: string; readonly content: string }): Promise<void>
}

export function createAgentApi(host: AntigravityHost, run: AntigravityProbeOptions['run'] = runCli): AgentApi {
  const env = (projectId: string): Readonly<Record<string, string>> => ({
    ANTIGRAVITY_LS_ADDRESS: host.address,
    ANTIGRAVITY_CSRF_TOKEN: host.csrfToken,
    ANTIGRAVITY_PROJECT_ID: projectId
  })
  const parse = (result: { stdout: string; stderr: string }): { response?: Record<string, unknown>; error?: string } => {
    try {
      return JSON.parse(result.stdout) as { response?: Record<string, unknown>; error?: string }
    } catch {
      return { error: `Antigravity's agent API did not answer with JSON: ${result.stderr.slice(0, 200) || result.stdout.slice(0, 200)}` }
    }
  }
  return {
    async newConversation(input) {
      const result = await run(host.executablePath, ['agentapi', 'new-conversation', `--model=${input.model}`, `--title=${input.title}`, input.prompt], env(input.projectId))
      const parsed = parse(result)
      if (parsed.error !== undefined) throw new Error(parsed.error)
      const created = (parsed.response?.newConversation as { conversationId?: unknown } | undefined)?.conversationId
      if (typeof created !== 'string' || created.length === 0) throw new Error("Antigravity did not return a conversation id.")
      return created
    },
    async sendMessage(input) {
      const result = await run(host.executablePath, ['agentapi', 'send-message', input.conversationId, input.content], env(input.projectId))
      const parsed = parse(result)
      if (parsed.error !== undefined) throw new Error(parsed.error)
    }
  }
}

/** The project id Antigravity gave the mission workspace, or undefined when it has not opened that folder. */
export function projectIdFor(host: AntigravityHost, workspacePath: string): string | undefined {
  return projectIdForWorkspace(host.projects, workspacePath)
}
