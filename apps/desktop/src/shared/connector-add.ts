import type { MissionRuntimeId } from '@teammate/runtime-adapters'

/**
 * ONE CONNECTOR, ADDED TO EVERY AGENT YOU CHOOSE (0.716).
 *
 * Colin, 2026-10-09, of REA (an MCP server for reverse engineering) and of
 * the 10/08 field scan's settings sync: "sure you can run connectors, or
 * however you see fit." Each agent keeps its own list of MCP servers in its
 * own file, in its own format -- Claude Code's `.claude.json`, Codex's TOML,
 * Gemini's and Antigravity's JSON, Copilot's, OpenCode's JSONC -- and adding
 * one meant six different setups.
 *
 * Locust never edits those files. Every one of these agents has its own
 * `mcp add` command, MEASURED 2026-10-09 in a throwaway home on each CLI
 * (Claude Code 2.1.296, Codex 0.162.0, Gemini CLI, Copilot 1.0.95, OpenCode
 * 1.18.35, Antigravity 1.3.2): each wrote its own entry, command or web
 * address, in its own format. Locust runs those commands, the way a person
 * would type them, and says what each answered. Cursor Agent has no such
 * command, and its CLI rewrites its default model when run carelessly, so it
 * is not offered yet; Muse Code has not been measured.
 *
 * Nothing secret goes through here: no environment values, no headers. A
 * connector that needs a key is added in the agent itself, where the key
 * belongs.
 */

/** The agents Locust can add a connector to, in the order they are offered. */
export const CONNECTOR_AGENTS = ['claude', 'codex', 'gemini', 'copilot', 'opencode', 'antigravity'] as const satisfies readonly MissionRuntimeId[]
export type ConnectorAgent = (typeof CONNECTOR_AGENTS)[number]

export function isConnectorAgent(value: unknown): value is ConnectorAgent {
  return typeof value === 'string' && (CONNECTOR_AGENTS as readonly string[]).includes(value)
}

export type ConnectorRunsAs =
  | { readonly kind: 'command'; readonly command: string; readonly args: readonly string[] }
  | { readonly kind: 'url'; readonly url: string }

export interface ConnectorToAdd {
  readonly name: string
  readonly runsAs: ConnectorRunsAs
}

/** A name every one of the agents takes: letters, digits, `-` and `_`, starting with a letter or digit. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function connectorNameProblem(name: string): string | undefined {
  if (name.trim().length === 0) return 'Give it a name.'
  if (!NAME.test(name.trim())) return 'A name is letters, digits, - and _, up to 64, starting with a letter or digit.'
  return undefined
}

/**
 * A command line, split the way a shell would for this: spaces between
 * words, a word in "double" or 'single' quotes kept whole. Nothing else is
 * interpreted -- no variables, no globs, no pipes -- because nothing runs it
 * through a shell: each agent starts it itself.
 */
export function splitCommandLine(line: string): readonly string[] | undefined {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const char of line.trim()) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    word += char
    started = true
  }
  if (quote !== undefined) return undefined
  if (started) words.push(word)
  return words
}

/** What the person typed, as a connector, or why it is not one yet. */
export function connectorFrom(input: { readonly name: string; readonly kind: 'command' | 'url'; readonly value: string }): { readonly ok: true; readonly connector: ConnectorToAdd } | { readonly ok: false; readonly problem: string } {
  const nameProblem = connectorNameProblem(input.name)
  if (nameProblem !== undefined) return { ok: false, problem: nameProblem }
  const name = input.name.trim()
  if (input.kind === 'url') {
    let url: URL
    try {
      url = new URL(input.value.trim())
    } catch {
      return { ok: false, problem: 'That is not a web address. It starts with https://.' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, problem: 'A web address here starts with https:// or http://.' }
    return { ok: true, connector: { name, runsAs: { kind: 'url', url: url.toString() } } }
  }
  const words = splitCommandLine(input.value)
  if (words === undefined) return { ok: false, problem: 'A quote is left open in the command.' }
  const [command, ...args] = words
  if (command === undefined || command.length === 0) return { ok: false, problem: 'Write the command that starts it, such as npx -y rea-agents@6.3.0 mcp.' }
  return { ok: true, connector: { name, runsAs: { kind: 'command', command, args } } }
}

/**
 * The words each agent's own `mcp add` takes, for everywhere it runs (its
 * user scope, never one folder's). The shapes are the CLIs' own help and were
 * each run against a throwaway home on 2026-10-09; `--` keeps a server's own
 * flags (`npx -y ...`) from being read as the agent's.
 */
export function addArgs(agent: ConnectorAgent, connector: ConnectorToAdd): readonly string[] | undefined {
  const { name, runsAs } = connector
  const command = runsAs.kind === 'command' ? [runsAs.command, ...runsAs.args] : []
  switch (agent) {
    case 'claude':
      return runsAs.kind === 'url' ? ['mcp', 'add', '--scope', 'user', '--transport', 'http', name, runsAs.url] : ['mcp', 'add', '--scope', 'user', name, '--', ...command]
    case 'codex':
      return runsAs.kind === 'url' ? ['mcp', 'add', name, '--url', runsAs.url] : ['mcp', 'add', name, '--', ...command]
    case 'gemini':
      // Gemini CLI refuses `--` (measured: it printed its help), so the server's
      // words follow bare -- and one that spells a Gemini flag would be taken
      // as Gemini's. Then it is not offered a wrong entry: undefined, said why.
      if (runsAs.kind === 'url') return ['mcp', 'add', '--scope', 'user', '--transport', 'http', name, runsAs.url]
      return command.some((word) => GEMINI_FLAGS.has(word.split('=')[0]!)) ? undefined : ['mcp', 'add', '--scope', 'user', name, ...command]
    case 'copilot':
      return runsAs.kind === 'url' ? ['mcp', 'add', '--transport', 'http', name, runsAs.url] : ['mcp', 'add', name, '--', ...command]
    case 'opencode':
      return runsAs.kind === 'url' ? ['mcp', 'add', name, '--url', runsAs.url] : ['mcp', 'add', name, '--', ...command]
    case 'antigravity':
      // Its flags must come before the name; a URL is told apart by itself.
      return runsAs.kind === 'url' ? ['mcp', 'add', '--type', 'http', name, runsAs.url] : ['mcp', 'add', name, '--', ...command]
  }
}

/** Gemini CLI's own flags for `mcp add` (its help, 2026-10-09): a server word spelling one is read as Gemini's. */
const GEMINI_FLAGS: ReadonlySet<string> = new Set(['-d', '--debug', '-s', '--scope', '-t', '--transport', '--type', '-e', '--env', '-H', '--header', '--timeout', '--trust', '--description', '--include-tools', '--exclude-tools', '-h', '--help'])

/** Why an agent cannot be given a connector as written, when `addArgs` declines it. */
export function declinedWhy(agent: ConnectorAgent): string {
  return agent === 'gemini'
    ? 'Gemini CLI would read one of the command’s own flags as its own. Add it in Gemini CLI itself.'
    : 'It cannot take this connector as written.'
}

/** The words that take it out again, or undefined for an agent with no such command (OpenCode). */
export function removeArgs(agent: ConnectorAgent, name: string): readonly string[] | undefined {
  switch (agent) {
    case 'claude':
      return ['mcp', 'remove', '--scope', 'user', name]
    case 'gemini':
      return ['mcp', 'remove', '--scope', 'user', name]
    case 'codex':
    case 'copilot':
    case 'antigravity':
      return ['mcp', 'remove', name]
    case 'opencode':
      return undefined
  }
}

/** What happened at one agent, in a word the card draws. */
export type ConnectorOutcome = 'added' | 'had' | 'failed' | 'removed' | 'kept'

export interface ConnectorAgentResult {
  readonly agent: ConnectorAgent
  readonly outcome: ConnectorOutcome
  /** The agent's own words, when it refused or failed; never a secret, since none was sent. */
  readonly said?: string
}

export const CONNECTOR_ADD_CHANNEL = 'connectors:add'
export const CONNECTOR_REMOVE_CHANNEL = 'connectors:remove'

export interface ConnectorAddRequest {
  readonly name: string
  readonly kind: 'command' | 'url'
  readonly value: string
  readonly agents: readonly ConnectorAgent[]
}

export type ConnectorAddResponse =
  | { readonly ok: true; readonly results: readonly ConnectorAgentResult[] }
  | { readonly ok: false; readonly message: string }
