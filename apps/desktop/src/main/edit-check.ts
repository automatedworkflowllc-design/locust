import { spawn } from 'node:child_process'

import { releaseProcessTree } from '@teammate/runtime-adapters'

/**
 * A3.3: the person's check, run after a teammate's turn changed files.
 *
 * The command is the PERSON's, set in Settings for this folder -- never read
 * from the project, because a repository that could name a command Locust
 * runs after every turn is the hole 0.341 closed by another door. It runs in
 * the teammate's own folder (its worktree when it has one), bounded in time
 * and output, and what comes back is only what is NEW since the last check
 * there: a failure that was already failing is said once as "still failing
 * the same way", not re-listed as the teammate's doing.
 *
 * Nothing is sent to the teammate from here. The thread shows the result
 * and a person decides whether it goes back (Colin, 2026-09-25: the button,
 * not Claude Code's automatic Stop-hook loop, which can spend turns).
 */
export interface EditCheckResult {
  readonly command: string
  readonly outcome: 'passed' | 'failed' | 'timed-out' | 'could-not-run'
  /** Lines of output that were not in the last check in this folder. */
  readonly newLines: readonly string[]
  /** Failed, and nothing in the failure is new since the last check. */
  readonly unchanged: boolean
  /** No earlier check in this folder to compare with. */
  readonly first: boolean
}

export interface CheckRun {
  readonly exitCode: number | null
  readonly output: string
  readonly timedOut: boolean
  readonly error?: string
}

const CHECK_TIMEOUT_MS = 180_000
const CHECK_OUTPUT_BYTES = 256 * 1024
const MAX_NEW_LINES = 30
const MAX_LINE = 300

export function runCheckCommand(command: string, cwd: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckRun> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    const done = (run: CheckRun): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(run)
    }
    let child: ReturnType<typeof spawn>
    try {
      // Through the shell: it is a command line the person typed, pipes and all.
      child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      done({ exitCode: null, output: '', timedOut: false, error: error instanceof Error ? error.message : 'The check could not be started.' })
      return
    }
    const take = (chunk: Buffer): void => {
      if (output.length < CHECK_OUTPUT_BYTES) output += chunk.toString('utf8')
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.on('error', (error) => done({ exitCode: null, output, timedOut, error: error.message }))
    child.on('close', (code) => done({ exitCode: code, output, timedOut }))
    const timer = setTimeout(() => {
      timedOut = true
      // The whole tree: a test runner's workers outlive its shell.
      void releaseProcessTree(child.pid).then((released) => {
        if (!released) child.kill()
      })
    }, timeoutMs)
  })
}

/**
 * The check's output as lines worth comparing. Colour codes and timings are
 * dropped -- "Duration 3.21s" differs on every run and says nothing about
 * what broke -- and the rest is compared exactly.
 */
export function comparableLines(output: string): readonly string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length === 0) continue
    if (/^(?:start at|duration|time:|finished in|ran \d+ tests? in)\b/i.test(line)) continue
    if (/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b\)?$/i.test(line) && line.length < 40) continue
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines
}

export function createEditCheck(options: {
  /** This folder's command, read fresh each time, or undefined for none. */
  readonly commandFor: () => Promise<string | undefined>
  readonly run?: (command: string, cwd: string) => Promise<CheckRun>
}) {
  const run = options.run ?? ((command: string, cwd: string) => runCheckCommand(command, cwd))
  const last = new Map<string, ReadonlySet<string>>()
  const busy = new Set<string>()
  return {
    async after(cwd: string): Promise<EditCheckResult | undefined> {
      const command = await options.commandFor().catch(() => undefined)
      if (command === undefined || command.length === 0) return undefined
      // One at a time per folder: two at once would each see the other's files.
      if (busy.has(cwd)) return undefined
      busy.add(cwd)
      try {
        const result = await run(command, cwd)
        const lines = comparableLines(result.output)
        const before = last.get(cwd)
        last.set(cwd, new Set(lines))
        const first = before === undefined
        const bounded = (list: readonly string[]) => list.slice(-MAX_NEW_LINES).map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line))
        if (result.error !== undefined) return { command, outcome: 'could-not-run', newLines: bounded([result.error]), unchanged: false, first }
        if (result.timedOut) return { command, outcome: 'timed-out', newLines: [], unchanged: false, first }
        if (result.exitCode === 0) return { command, outcome: 'passed', newLines: [], unchanged: false, first }
        const fresh = first ? lines : lines.filter((line) => !before.has(line))
        return { command, outcome: 'failed', newLines: bounded(fresh), unchanged: !first && fresh.length === 0, first }
      } finally {
        busy.delete(cwd)
      }
    }
  }
}
