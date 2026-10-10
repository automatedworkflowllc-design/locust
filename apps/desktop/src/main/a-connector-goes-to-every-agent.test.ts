import { describe, expect, it } from 'vitest'

import type { CommandResult, ProbeCommand } from '@teammate/runtime-adapters'

import { addArgs, connectorFrom, connectorNameProblem, removeArgs, splitCommandLine } from '../shared/connector-add.js'
import type { ConnectorAgent, ConnectorToAdd } from '../shared/connector-add.js'
import { addConnector, agentHas, lastWords, listedNames, removeConnector } from './connector-add.js'
import type { AgentLaunch } from './connector-add.js'

/*
 * ONE CONNECTOR, ADDED TO EVERY AGENT YOU CHOOSE (0.716). Colin, of REA, an
 * MCP server: "sure you can run connectors, or however you see fit." Each
 * agent's own `mcp add` writes its own file; these are the words each was
 * MEASURED to take on 2026-10-09 in a throwaway home, and the listings are
 * the ones they printed there. The drive is
 * _tools/drive-a-connector-goes-to-every-agent.mjs: the real CLIs, a
 * throwaway home, and each agent's file read back.
 */

const REA: ConnectorToAdd = { name: 'rea', runsAs: { kind: 'command', command: 'npx', args: ['-y', 'rea-agents@6.3.0', 'mcp'] } }
const WEB: ConnectorToAdd = { name: 'docs', runsAs: { kind: 'url', url: 'https://example.com/mcp' } }

describe('the words each agent is given', () => {
  it('a command, after `--` wherever the agent takes one, so the server keeps its own flags', () => {
    expect(addArgs('claude', REA)).toEqual(['mcp', 'add', '--scope', 'user', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    expect(addArgs('codex', REA)).toEqual(['mcp', 'add', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    expect(addArgs('copilot', REA)).toEqual(['mcp', 'add', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    expect(addArgs('opencode', REA)).toEqual(['mcp', 'add', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    expect(addArgs('antigravity', REA)).toEqual(['mcp', 'add', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    // Gemini CLI printed its help at `--` (measured): its words follow bare.
    expect(addArgs('gemini', REA)).toEqual(['mcp', 'add', '--scope', 'user', 'rea', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
  })

  it('a web address, as each one spells it', () => {
    expect(addArgs('claude', WEB)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'docs', 'https://example.com/mcp'])
    expect(addArgs('codex', WEB)).toEqual(['mcp', 'add', 'docs', '--url', 'https://example.com/mcp'])
    expect(addArgs('gemini', WEB)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'docs', 'https://example.com/mcp'])
    expect(addArgs('copilot', WEB)).toEqual(['mcp', 'add', '--transport', 'http', 'docs', 'https://example.com/mcp'])
    expect(addArgs('opencode', WEB)).toEqual(['mcp', 'add', 'docs', '--url', 'https://example.com/mcp'])
    // Antigravity's flags come before the name.
    expect(addArgs('antigravity', WEB)).toEqual(['mcp', 'add', '--type', 'http', 'docs', 'https://example.com/mcp'])
  })

  it('Gemini CLI is not handed a command whose words spell one of its own flags', () => {
    const clash: ConnectorToAdd = { name: 'x', runsAs: { kind: 'command', command: 'node', args: ['server.js', '-e', 'A=1'] } }
    const clashWithValue: ConnectorToAdd = { name: 'x', runsAs: { kind: 'command', command: 'node', args: ['server.js', '--timeout=5'] } }
    expect(addArgs('gemini', clash)).toBeUndefined()
    expect(addArgs('gemini', clashWithValue)).toBeUndefined()
    // The others take it whole, after `--`.
    expect(addArgs('codex', clash)).toEqual(['mcp', 'add', 'x', '--', 'node', 'server.js', '-e', 'A=1'])
  })

  it('takes it out with each one’s own remove, and OpenCode, which has none, is not pretended to', () => {
    expect(removeArgs('claude', 'rea')).toEqual(['mcp', 'remove', '--scope', 'user', 'rea'])
    expect(removeArgs('gemini', 'rea')).toEqual(['mcp', 'remove', '--scope', 'user', 'rea'])
    expect(removeArgs('codex', 'rea')).toEqual(['mcp', 'remove', 'rea'])
    expect(removeArgs('copilot', 'rea')).toEqual(['mcp', 'remove', 'rea'])
    expect(removeArgs('antigravity', 'rea')).toEqual(['mcp', 'remove', 'rea'])
    expect(removeArgs('opencode', 'rea')).toBeUndefined()
  })
})

describe('what the person typed', () => {
  it('a command line splits on spaces, keeps quoted words whole, and interprets nothing else', () => {
    expect(splitCommandLine('npx -y rea-agents@6.3.0 mcp')).toEqual(['npx', '-y', 'rea-agents@6.3.0', 'mcp'])
    expect(splitCommandLine('  node "C:/My Tools/server.js"  --root \'a b\' ')).toEqual(['node', 'C:/My Tools/server.js', '--root', 'a b'])
    expect(splitCommandLine('echo "" $HOME')).toEqual(['echo', '', '$HOME'])
    expect(splitCommandLine('node "unclosed')).toBeUndefined()
    expect(splitCommandLine('   ')).toEqual([])
  })

  it('a name every agent takes, or why not', () => {
    expect(connectorNameProblem('rea')).toBeUndefined()
    expect(connectorNameProblem('my_server-2')).toBeUndefined()
    expect(connectorNameProblem('')).toBe('Give it a name.')
    expect(connectorNameProblem('two words')).toMatch(/letters, digits, - and _/)
    expect(connectorNameProblem('-flag')).toMatch(/starting with a letter or digit/)
    expect(connectorNameProblem('a'.repeat(65))).toMatch(/up to 64/)
  })

  it('becomes a connector, or says what is missing', () => {
    expect(connectorFrom({ name: ' rea ', kind: 'command', value: 'npx -y rea-agents@6.3.0 mcp' })).toEqual({ ok: true, connector: REA })
    expect(connectorFrom({ name: 'docs', kind: 'url', value: 'https://example.com/mcp' })).toEqual({ ok: true, connector: WEB })
    expect(connectorFrom({ name: 'rea', kind: 'command', value: '' })).toEqual({ ok: false, problem: 'Write the command that starts it, such as npx -y rea-agents@6.3.0 mcp.' })
    expect(connectorFrom({ name: 'rea', kind: 'command', value: 'node "x' })).toEqual({ ok: false, problem: 'A quote is left open in the command.' })
    expect(connectorFrom({ name: 'docs', kind: 'url', value: 'example.com/mcp' }).ok).toBe(false)
    expect(connectorFrom({ name: 'docs', kind: 'url', value: 'file:///C:/server' })).toEqual({ ok: false, problem: 'A web address here starts with https:// or http://.' })
  })
})

/* The listings as printed in the throwaway home, 2026-10-09 (OpenCode's with its colours). */
const GEMINI_LIST =
  'Warning: MCP servers are configured but disabled because this folder is untrusted.\n' +
  'User-level servers are also suppressed in untrusted folders to prevent accidental side-effects.\n\n' +
  'Configured MCP servers:\n\n' +
  '\u25cb probe-web: https://example.com/mcp (http) - Disabled\n'
const ANTIGRAVITY_LIST =
  'NAME        TYPE   STATUS   COMMAND/URL\n' +
  'probe-dash  stdio  enabled  npx -y rea-agents@6.3.0 mcp\n' +
  'probe-web   http   enabled  https://example.com/mcp\n'
const OPENCODE_LIST =
  '\u001b[0m\r\n' +
  '\u001b[90m\u250c\u001b[39m  MCP Servers\n' +
  '\u001b[90m\u2502\u001b[39m\n' +
  '\u001b[34m\u25cf\u001b[39m  \u2717 probe-web \u001b[90mfailed\n' +
  '\u001b[90m\u2502\u001b[39m      SSE error: Non-200 status code (404)\n' +
  '\u001b[90m\u2502\u001b[39m      \u001b[90mhttps://example.com/mcp\n' +
  '\u001b[90m\u2502\u001b[39m\n' +
  '\u001b[34m\u25cf\u001b[39m  \u2713 probe-local \u001b[90mconnected\n' +
  '\u001b[90m\u2514\u001b[39m  2 server(s)\n'

describe('whether an agent already has one', () => {
  it('reads the names from the listings of the three with no `get`', () => {
    expect([...listedNames('gemini', GEMINI_LIST)]).toEqual(['probe-web'])
    expect([...listedNames('antigravity', ANTIGRAVITY_LIST)]).toEqual(['probe-dash', 'probe-web'])
    expect([...listedNames('opencode', OPENCODE_LIST)]).toEqual(['probe-web', 'probe-local'])
    // A URL or an error line is never a name.
    expect(listedNames('opencode', OPENCODE_LIST).has('https://example.com/mcp')).toBe(false)
  })

  it('asks the three with a `get` by its exit code, and an answer it cannot read is not a no', async () => {
    const launch: AgentLaunch = { executablePath: 'C:/bin/claude.exe', prefixArgs: [] }
    const by = (exitCode: number | null, timedOut = false): FakeRunner => fakeRunner(() => ({ exitCode, stdout: '', stderr: '', ...(timedOut ? { timedOut } : {}) }))
    expect(await agentHas('claude', 'rea', launch, by(0))).toBe(true)
    expect(await agentHas('claude', 'rea', launch, by(1))).toBe(false)
    expect(await agentHas('claude', 'rea', launch, by(2))).toBeUndefined()
    expect(await agentHas('claude', 'rea', launch, by(null, true))).toBeUndefined()
    const asked = by(1)
    await agentHas('codex', 'rea', { executablePath: 'C:/node.exe', prefixArgs: ['C:/codex.js'] }, asked)
    expect(asked.calls[0]!.args).toEqual(['C:/codex.js', 'mcp', 'get', 'rea'])
  })
})

interface FakeRunner {
  readonly calls: ProbeCommand[]
  run(command: ProbeCommand): Promise<CommandResult>
}

function fakeRunner(answer: (command: ProbeCommand) => CommandResult): FakeRunner {
  const calls: ProbeCommand[] = []
  return {
    calls,
    run: async (command) => {
      calls.push(command)
      return answer(command)
    }
  }
}

const LAUNCHES: Readonly<Record<ConnectorAgent, AgentLaunch>> = {
  claude: { executablePath: 'C:/bin/claude.exe', prefixArgs: [] },
  codex: { executablePath: 'C:/bin/codex.exe', prefixArgs: [] },
  gemini: { executablePath: 'C:/bin/node.exe', prefixArgs: ['C:/bin/gemini.js'] },
  copilot: { executablePath: 'C:/bin/copilot.exe', prefixArgs: [] },
  opencode: { executablePath: 'C:/bin/opencode.exe', prefixArgs: [] },
  antigravity: { executablePath: 'C:/bin/agy.exe', prefixArgs: [] }
}

/** Which agent a command went to, by the launch it was given. */
const who = (command: ProbeCommand): string =>
  Object.entries(LAUNCHES).find(([, launch]) => launch.executablePath === command.executablePath && launch.prefixArgs.every((word, at) => command.args[at] === word))?.[0] ?? '?'

describe('adding one to every agent chosen', () => {
  it('adds where there is none, keeps one already there, and writes nothing where it cannot tell', async () => {
    const runner = fakeRunner((command) => {
      const agent = who(command)
      const words = command.args.join(' ')
      if (words.includes('mcp get')) return { exitCode: agent === 'codex' ? 0 : agent === 'copilot' ? 2 : 1, stdout: '', stderr: '' }
      if (words.includes('mcp list')) return agent === 'antigravity' ? { exitCode: 0, stdout: ANTIGRAVITY_LIST.replace('probe-dash', 'rea'), stderr: '' } : { exitCode: null, stdout: '', stderr: '', timedOut: true }
      return { exitCode: 0, stdout: 'Added stdio MCP server rea', stderr: '' }
    })
    const answer = await addConnector(
      { name: 'rea', kind: 'command', value: 'npx -y rea-agents@6.3.0 mcp', agents: ['claude', 'codex', 'copilot', 'opencode', 'antigravity'] },
      (agent) => LAUNCHES[agent],
      runner
    )
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(Object.fromEntries(answer.results.map((one) => [one.agent, one.outcome]))).toEqual({
      claude: 'added',
      codex: 'had',
      copilot: 'failed',
      opencode: 'failed',
      antigravity: 'had'
    })
    expect(answer.results.find((one) => one.agent === 'opencode')!.said).toBe('It did not say whether it already has one named rea, so nothing was changed.')
    // The one add that ran is Claude Code's, in exactly its words; nobody else was written to.
    const adds = runner.calls.filter((command) => command.args.includes('add'))
    expect(adds.map(who)).toEqual(['claude'])
    expect(adds[0]!.args).toEqual(['mcp', 'add', '--scope', 'user', 'rea', '--', 'npx', '-y', 'rea-agents@6.3.0', 'mcp'])
  })

  it('an agent that is not installed, or cannot take it as written, is said and never run', async () => {
    const runner = fakeRunner(() => ({ exitCode: 1, stdout: '', stderr: '' }))
    const answer = await addConnector(
      { name: 'x', kind: 'command', value: 'node server.js -e A=1', agents: ['gemini', 'copilot'] },
      (agent) => (agent === 'copilot' ? undefined : LAUNCHES[agent]),
      runner
    )
    expect(answer.ok && answer.results).toEqual([
      { agent: 'gemini', outcome: 'failed', said: 'Gemini CLI would read one of the command’s own flags as its own. Add it in Gemini CLI itself.' },
      { agent: 'copilot', outcome: 'failed', said: 'Copilot CLI is not installed here.' }
    ])
    expect(runner.calls).toHaveLength(0)
  })

  it('a refusal comes back in the agent’s own last words', async () => {
    const runner = fakeRunner((command) =>
      command.args.includes('get') ? { exitCode: 1, stdout: '', stderr: '' } : { exitCode: 1, stdout: '', stderr: '\u001b[31mError: MCP server rea already exists in user config\u001b[39m\n' }
    )
    const answer = await addConnector({ name: 'rea', kind: 'command', value: 'npx -y rea-agents@6.3.0 mcp', agents: ['claude'] }, (agent) => LAUNCHES[agent], runner)
    expect(answer.ok && answer.results).toEqual([{ agent: 'claude', outcome: 'failed', said: 'Error: MCP server rea already exists in user config' }])
  })

  it('something that is not a connector yet goes to no agent at all', async () => {
    const runner = fakeRunner(() => ({ exitCode: 0, stdout: '', stderr: '' }))
    expect(await addConnector({ name: 'bad name', kind: 'command', value: 'npx x', agents: ['claude'] }, (agent) => LAUNCHES[agent], runner)).toEqual({
      ok: false,
      message: 'A name is letters, digits, - and _, up to 64, starting with a letter or digit.'
    })
    expect(runner.calls).toHaveLength(0)
  })
})

describe('Undo', () => {
  it('runs each agent’s own remove, and says where OpenCode keeps its copy', async () => {
    const runner = fakeRunner(() => ({ exitCode: 0, stdout: '', stderr: '' }))
    const results = await removeConnector('rea', ['claude', 'opencode'], (agent) => LAUNCHES[agent], runner)
    expect(results).toEqual([
      { agent: 'claude', outcome: 'removed' },
      { agent: 'opencode', outcome: 'kept', said: 'OpenCode has no command to remove one: delete it from the "mcp" section of its opencode.json.' }
    ])
    expect(runner.calls.map((command) => command.args)).toEqual([['mcp', 'remove', '--scope', 'user', 'rea']])
  })
})

describe('an agent’s last words', () => {
  it('the last line that says something, without colours, frames or Codex’s PATH warning', () => {
    expect(lastWords('', '\u001b[33mWARNING: proceeding, even though we could not update PATH: Access is denied.\u001b[39m\nError: invalid server name\n')).toBe('Error: invalid server name')
    expect(lastWords('│  ✗ could not write config\n│\n', '')).toBe('could not write config')
    expect(lastWords('', '')).toBeUndefined()
    expect(lastWords('x'.repeat(400), '')!.length).toBe(220)
  })
})
