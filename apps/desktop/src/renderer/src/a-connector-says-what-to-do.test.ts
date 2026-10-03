// W8 (0.567): Settings > Connectors says each connector's state in words and
// what to do, and Copy report carries names, states, timings and hosts --
// never a command, its arguments, its environment, or a URL's path.
import { expect, it } from 'vitest'

import type { PublicConnector } from '../../shared/ipc.js'
import { connectorReport, connectorStateWords, connectorWhere, lastWorked } from './connectorHealth.js'

const now = new Date('2026-10-03T12:00:00.000Z')
const connectors: readonly PublicConnector[] = [
  { name: 'alpha', location: 'https://alpha.example/mcp/v1?token=SECRET', status: 'connected', checkedInMs: 2_340, lastConnectedAt: '2026-10-03T11:55:00.000Z' },
  { name: 'beta', location: 'https://beta.example/mcp', status: 'needs-auth', checkedInMs: 2_340 },
  { name: 'gamma', location: 'node C:\\srv\\gamma.js --api-key SECRET2 API_TOKEN=SECRET3', status: 'failed', checkedInMs: 2_340 },
  { name: 'delta', location: 'https://delta.example/mcp', status: 'timed-out', lastConnectedAt: '2026-10-03T09:00:00.000Z' },
  { name: 'epsilon', location: 'https://epsilon.example/mcp', status: 'unreadable', said: '⏳ Pending approval' }
]

it('says each state in words, with what to do', () => {
  expect(connectors.map((connector) => connectorStateWords(connector).state)).toEqual(['Connected', 'Needs sign-in', 'Not working', 'Did not answer', 'Unknown'])
  expect(connectorStateWords(connectors[1]!).todo).toBe('Run /mcp in Claude Code and sign in to beta.')
  expect(connectorStateWords(connectors[2]!).todo).toBe('Claude Code could not start or reach it.')
  expect(connectorStateWords(connectors[3]!).todo).toMatch(/did not answer in 20 seconds/)
  expect(connectorStateWords(connectors[4]!).todo).toBe('Claude Code said: \u201c⏳ Pending approval\u201d')
})

it('says when it last worked', () => {
  expect(lastWorked(connectors[0]!, now)).toBe('Last connected 5 min ago.')
  expect(lastWorked(connectors[3]!, now)).toBe('Last connected 3 h ago.')
  expect(lastWorked(connectors[1]!, now)).toBe('Not seen connected since Locust started.')
})

it('says where a connector lives only as a host, or as a program on this computer', () => {
  expect(connectorWhere('https://alpha.example/mcp/v1?token=SECRET')).toBe('alpha.example')
  expect(connectorWhere('node C:\\srv\\gamma.js --api-key SECRET2')).toBe('a program on this computer')
})

it('the report has names, states, timings and hosts, and nothing else', () => {
  const report = connectorReport(connectors, now)
  for (const connector of connectors) expect(report).toContain(connector.name)
  expect(report).toContain('Last check took 2.3 s.')
  expect(report).toContain('alpha.example')
  for (const secret of ['SECRET', 'token=', '/mcp/v1', 'node ', 'gamma.js', '--api-key', 'API_TOKEN', 'C:\\srv']) expect(report).not.toContain(secret)
})
