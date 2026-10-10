import type { CommandRunner } from '@teammate/runtime-adapters'

import { addArgs, connectorFrom, declinedWhy, removeArgs } from '../shared/connector-add.js'
import type { ConnectorAddRequest, ConnectorAgent, ConnectorAgentResult } from '../shared/connector-add.js'
import { runtimeDisplayName } from '../shared/runtimes.js'

/**
 * ADDING A CONNECTOR, AGENT BY AGENT (0.716; shared/connector-add.ts says why).
 *
 * For each agent the person chose, in parallel: does it already have a
 * connector of that name -- asked of the agent itself -- and only if it does
 * not, its own `mcp add`. An agent that has one keeps it untouched: four of
 * the six overwrite a name silently (measured; only Claude Code refuses), and
 * the one already there may hold a key Locust never saw. An agent whose
 * answer cannot be read is not written to at all.
 */

/** How to start one agent's CLI, as discovery found it. */
export interface AgentLaunch {
  readonly executablePath: string
  readonly prefixArgs: readonly string[]
  readonly env?: Readonly<Record<string, string>>
}

/** A listing can be slow -- OpenCode's connects to every server -- but never unbounded. */
const LIST_TIMEOUT_MS = 50_000
const CHANGE_TIMEOUT_MS = 40_000

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

function plain(text: string): string {
  return text.replace(ANSI, '')
}

/** The agent's last meaningful line, for a card: never more than a sentence. */
export function lastWords(stdout: string, stderr: string): string | undefined {
  const lines = plain(`${stderr}\n${stdout}`)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s│┌└◆●○✓✗|]+/, '').trim())
    .filter((line) => line.length > 0 && !/^WARNING: proceeding, even though/i.test(line))
  const last = lines.at(-1)
  return last === undefined ? undefined : last.length > 220 ? `${last.slice(0, 219)}…` : last
}

/**
 * The names an agent's own listing shows, for the three with no `get`:
 * Antigravity's table (`NAME TYPE STATUS ...`), Gemini CLI's `○ name: ...`
 * lines, OpenCode's `✓ name` / `✗ name` lines. Formats measured 2026-10-09.
 */
export function listedNames(agent: ConnectorAgent, output: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const raw of plain(output).split(/\r?\n/)) {
    const line = raw.trim()
    if (agent === 'antigravity') {
      const first = /^(\S+)\s+(stdio|http|sse)\s/i.exec(line)
      if (first !== null && first[1] !== 'NAME') names.add(first[1]!)
      continue
    }
    if (agent === 'gemini') {
      const named = /^[○✓✗●◐⊘✔✘•-]\s+([^:\s]+):/.exec(line)
      if (named !== null) names.add(named[1]!)
      continue
    }
    if (agent === 'opencode') {
      const named = /(?:^|\s)[✓✗]\s+(\S+)/.exec(line.replace(/^[│●\s]+/, ''))
      if (named !== null) names.add(named[1]!)
    }
  }
  return names
}

/** Whether the agent already has one by this name: true, false, or undefined when it could not be told. */
export async function agentHas(agent: ConnectorAgent, name: string, launch: AgentLaunch, runner: CommandRunner): Promise<boolean | undefined> {
  const run = (args: readonly string[]): ReturnType<CommandRunner['run']> =>
    runner.run({ purpose: 'capabilities', executablePath: launch.executablePath, args: [...launch.prefixArgs, ...args], timeoutMs: LIST_TIMEOUT_MS, ...(launch.env === undefined ? {} : { env: launch.env }) })
  if (agent === 'claude' || agent === 'codex' || agent === 'copilot') {
    const answer = await run(['mcp', 'get', name])
    if (answer.timedOut === true) return undefined
    return answer.exitCode === 0 ? true : answer.exitCode === 1 ? false : undefined
  }
  const answer = await run(['mcp', 'list'])
  if (answer.timedOut === true) return undefined
  return listedNames(agent, `${answer.stdout}\n${answer.stderr}`).has(name)
}

export async function addConnector(
  request: ConnectorAddRequest,
  launchOf: (agent: ConnectorAgent) => AgentLaunch | undefined,
  runner: CommandRunner
): Promise<{ readonly ok: true; readonly results: readonly ConnectorAgentResult[] } | { readonly ok: false; readonly message: string }> {
  const read = connectorFrom(request)
  if (!read.ok) return { ok: false, message: read.problem }
  const { connector } = read
  const results = await Promise.all(
    [...new Set(request.agents)].map(async (agent): Promise<ConnectorAgentResult> => {
      const launch = launchOf(agent)
      if (launch === undefined) return { agent, outcome: 'failed', said: `${runtimeDisplayName(agent)} is not installed here.` }
      const args = addArgs(agent, connector)
      if (args === undefined) return { agent, outcome: 'failed', said: declinedWhy(agent) }
      try {
        const has = await agentHas(agent, connector.name, launch, runner)
        if (has === true) return { agent, outcome: 'had' }
        if (has === undefined) return { agent, outcome: 'failed', said: `It did not say whether it already has one named ${connector.name}, so nothing was changed.` }
        const answer = await runner.run({ purpose: 'capabilities', executablePath: launch.executablePath, args: [...launch.prefixArgs, ...args], timeoutMs: CHANGE_TIMEOUT_MS, ...(launch.env === undefined ? {} : { env: launch.env }) })
        if (answer.exitCode === 0 && answer.timedOut !== true) return { agent, outcome: 'added' }
        const said = answer.timedOut === true ? 'It did not answer in time; check its connectors before trying again.' : lastWords(answer.stdout, answer.stderr)
        return { agent, outcome: 'failed', ...(said === undefined ? {} : { said }) }
      } catch {
        return { agent, outcome: 'failed', said: 'It could not be started.' }
      }
    })
  )
  return { ok: true, results }
}

/**
 * Undo, right after an add: each agent's own `mcp remove`, for the agents
 * that were just given it. OpenCode has no remove command (measured), so it
 * keeps its copy and the card says where it lives.
 */
export async function removeConnector(
  name: string,
  agents: readonly ConnectorAgent[],
  launchOf: (agent: ConnectorAgent) => AgentLaunch | undefined,
  runner: CommandRunner
): Promise<readonly ConnectorAgentResult[]> {
  return Promise.all(
    [...new Set(agents)].map(async (agent): Promise<ConnectorAgentResult> => {
      const args = removeArgs(agent, name)
      if (args === undefined) return { agent, outcome: 'kept', said: 'OpenCode has no command to remove one: delete it from the "mcp" section of its opencode.json.' }
      const launch = launchOf(agent)
      if (launch === undefined) return { agent, outcome: 'failed', said: `${runtimeDisplayName(agent)} is not installed here.` }
      try {
        const answer = await runner.run({ purpose: 'capabilities', executablePath: launch.executablePath, args: [...launch.prefixArgs, ...args], timeoutMs: CHANGE_TIMEOUT_MS, ...(launch.env === undefined ? {} : { env: launch.env }) })
        if (answer.exitCode === 0 && answer.timedOut !== true) return { agent, outcome: 'removed' }
        const said = lastWords(answer.stdout, answer.stderr)
        return { agent, outcome: 'failed', ...(said === undefined ? {} : { said }) }
      } catch {
        return { agent, outcome: 'failed', said: 'It could not be started.' }
      }
    })
  )
}
