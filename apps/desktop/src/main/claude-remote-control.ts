import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { killSpawnedTree, spawnShape, type ExecutableLaunch, type RuntimeDiscovery } from '@teammate/runtime-adapters'
import type { RemoteControlState } from '../shared/claude-remote-control.js'
import { consoleCommandLine } from './runtime-sign-in.js'
import { openInMacTerminal } from './mac-terminal.js'
import { plainTerminalText } from './pseudo-terminal.js'

// Colin: "Build the Settings switch and its process handling with unit tests only
// (arguments; process ended when the switch goes off or Locust quits;
// first lines and errors shown verbatim)." Never answer a trust/enable prompt.
export const REMOTE_CONTROL_ARGS = ['remote-control', '--spawn', 'worktree', '--name', 'Locust'] as const
const NEEDS_PERSON = new RegExp(String.raw`Trust [^\n]*\?\s*\[y/N\]|Workspace not trusted|Quick safety check|trust this folder|Do you trust|Enable Remote Control\?\s*\(y/n\)`, 'i')
const LIMIT = 64 * 1024

/** A setup terminal, not an unmanaged Remote Control server. The person
 * signs in / trusts the folder here, then deliberately enables the switch again. */
export async function openRemoteControlSetup(launch: ExecutableLaunch, cwd: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    const result = await openInMacTerminal(cwd, { file: launch.executablePath, args: launch.prefixArgs }, launch.env)
    if (!result.ok) throw new Error(result.message)
    return
  }
  if (platform !== 'win32') throw new Error('Open Claude Code in a terminal in this folder to complete setup, then enable this switch again.')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', [consoleCommandLine(launch.executablePath, launch.prefixArgs.map((arg) => `"${arg}"`))], {
      cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
      env: { ...process.env, ...launch.env }
    })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export interface RemoteControlOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly folder: () => string
  readonly spawn?: typeof spawn
  readonly killTree?: (pid: number, platform: NodeJS.Platform) => void
  readonly openSetup?: (launch: ExecutableLaunch, cwd: string, platform: NodeJS.Platform) => Promise<void>
  readonly platform?: NodeJS.Platform
  readonly stopDeadlineMs?: number
}

/** One owned process per Locust lifetime; no saved opt-in or automatic retry. */
export function createRemoteControl(options: RemoteControlOptions) {
  const platform = options.platform ?? process.platform
  let state: RemoteControlState = { enabled: false, phase: 'off', stdout: '', stderr: '', truncated: false }
  let disposed = false
  let generation = 0
  let child: ChildProcess | undefined
  let ended: Promise<void> = Promise.resolve()
  let settle: (() => void) | undefined
  let stopping: Promise<void> | undefined
  const snapshot = (): RemoteControlState => ({ ...state })
  const problem = (error: unknown) => { state = { ...state, error: error instanceof Error ? error.message : String(error) } }
  const stop = (): Promise<void> => {
    if (stopping !== undefined) return stopping
    const owned = child
    if (owned === undefined) return Promise.resolve()
    state = { ...state, enabled: false, phase: 'stopping' }
    // Wait for close, not just a successful signal. Kill only this owned tree.
    stopping = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Claude Code did not report that its Remote Control process ended.')), options.stopDeadlineMs ?? 4000)
      ended.then(() => { clearTimeout(timer); resolve() })
      try {
        if (owned.pid !== undefined) (options.killTree ?? killSpawnedTree)(owned.pid, platform)
        owned.kill('SIGKILL')
      } catch (error) { clearTimeout(timer); reject(error) }
    }).finally(() => { stopping = undefined })
    return stopping
  }
  const setEnabled = async (enabled: boolean): Promise<RemoteControlState> => {
    if (enabled && state.enabled && !disposed) return snapshot()
    const token = ++generation
    if (!enabled || disposed) {
      state = { ...state, enabled: false }
      try { await stop(); if (token === generation) state = { ...state, phase: 'off' } }
      catch (error) { if (token === generation) { problem(error); state = { ...state, phase: 'error' } } }
      return snapshot()
    }
    if (child !== undefined) return snapshot()
    state = { enabled: true, phase: 'starting', stdout: '', stderr: '', truncated: false }
    try {
      const launch = (await options.discover()).find((runtime) => runtime.id === 'claude')?.executable
      if (token !== generation || disposed) return snapshot()
      if (launch === undefined) throw new Error('Claude Code is not installed here. Settings > AI agents shows how to add it.')
      const cwd = options.folder()
      const shape = spawnShape(launch.executablePath, [...launch.prefixArgs, ...REMOTE_CONTROL_ARGS])
      const owned = (options.spawn ?? spawn)(launch.executablePath, [...shape.args], {
        cwd, env: { ...process.env, ...launch.env }, shell: false, windowsHide: true,
        detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        ...(shape.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {})
      })
      child = owned
      ended = new Promise<void>((resolve) => { settle = resolve })
      let asks = false
      let watched = ''
      let setupStarted = false
      const setup = async () => {
        if (setupStarted) return
        setupStarted = true
        state = { ...state, enabled: false }
        try {
          await stop()
          if (disposed || token !== generation) return
          state = { ...state, phase: 'needs-person' }
          await (options.openSetup ?? openRemoteControlSetup)(launch, cwd, platform)
        } catch (error) { if (token === generation && !disposed) { problem(error); state = { ...state, phase: 'error' } } }
      }
      const append = (stream: 'stdout' | 'stderr', text: string) => {
        const room = LIMIT - state[stream].length
        state = { ...state, [stream]: state[stream] + text.slice(0, Math.max(0, room)), truncated: state.truncated || text.length > room }
        // Detect across chunks, even after the retained first lines reach their cap.
        watched = (watched + text).slice(-8192)
        if (!asks && NEEDS_PERSON.test(plainTerminalText(watched))) { asks = true; void setup() }
      }
      for (const stream of ['stdout', 'stderr'] as const) {
        const decoder = new StringDecoder('utf8')
        owned[stream]?.on('data', (chunk: Buffer | string) => append(stream, typeof chunk === 'string' ? chunk : decoder.write(chunk)))
        owned[stream]?.on('end', () => append(stream, decoder.end()))
      }
      owned.once('spawn', () => { if (!asks && token === generation && state.phase === 'starting') state = { ...state, phase: 'running' } })
      owned.once('error', (error) => { problem(error); state = { ...state, enabled: false, phase: 'error' } })
      owned.once('close', (code) => {
        child = undefined
        settle?.(); settle = undefined
        state = { ...state, enabled: false, exitCode: code,
          phase: asks ? 'needs-person' : state.phase === 'stopping' ? 'off' : state.phase === 'error' || code !== 0 ? 'error' : 'ended' }
      })
    } catch (error) {
      if (token === generation) { problem(error); state = { ...state, enabled: false, phase: 'error' } }
    }
    return snapshot()
  }
  return { snapshot, setEnabled, async dispose(): Promise<void> { disposed = true; ++generation; state = { ...state, enabled: false }; await stop() } }
}
