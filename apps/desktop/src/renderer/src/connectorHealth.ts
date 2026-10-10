import type { PublicConnector } from '../../shared/ipc.js'

/**
 * EACH CONNECTOR'S STATE, IN WORDS, AND WHAT TO DO (W8, 0.567), for Settings >
 * Connectors -- MCP Inspector's vocabulary, said the way a person acts on it.
 * Nothing here calls a connector's tools to test it: the state is what
 * Claude Code's own `mcp list` health check said.
 */
export function connectorStateWords(connector: PublicConnector): { readonly state: string; readonly todo?: string; readonly tone: 'good' | 'amber' | 'red' } {
  switch (connector.status) {
    case 'connected':
      return { state: 'Connected', tone: 'good' }
    case 'needs-auth':
      return { state: 'Needs sign-in', todo: `Run /mcp in Claude Code and sign in to ${connector.name}.`, tone: 'amber' }
    case 'failed':
      return { state: 'Not working', todo: 'Claude Code could not start or reach it.', tone: 'red' }
    case 'timed-out':
      return { state: 'Did not answer', todo: 'It did not answer in 20 seconds. Check again in a moment.', tone: 'amber' }
    case 'unreadable':
      return { state: 'Unknown', todo: `Claude Code said: “${connector.said ?? ''}”`, tone: 'amber' }
  }
}

/** When it last worked, said plainly. */
export function lastWorked(connector: PublicConnector, now: Date = new Date()): string {
  if (connector.lastConnectedAt === undefined) return 'Not seen connected since Locust started.'
  const minutes = Math.floor((now.getTime() - Date.parse(connector.lastConnectedAt)) / 60_000)
  if (Number.isNaN(minutes)) return 'Not seen connected since Locust started.'
  return minutes < 1 ? 'Connected just now.' : minutes < 60 ? `Last connected ${String(minutes)} min ago.` : `Last connected ${String(Math.floor(minutes / 60))} h ago.`
}

/**
 * The line under a connector's name, or nothing (design pass, 0.715): a row
 * that is connected and was checked a moment ago has nothing to add to its
 * own CONNECTED -- "Connected just now." under every working connector made
 * the list twice as tall and said the state twice. A connector to act on
 * keeps what to do, and an old reading keeps its age; the report still says
 * it all.
 */
export function connectorDetail(connector: PublicConnector, now: Date = new Date()): string | undefined {
  const words = connectorStateWords(connector)
  const when = lastWorked(connector, now)
  if (connector.status === 'connected' && when === 'Connected just now.') return undefined
  return words.todo === undefined ? when : `${words.todo} ${when}`
}

/**
 * Where it lives, as much as a report may say: a remote connector's host,
 * never its path or query; a local one is "a program on this computer", never
 * its command, arguments or environment.
 */
export function connectorWhere(location: string): string {
  try {
    const url = new URL(location)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.host
  } catch {
    // Not a URL: a command.
  }
  return 'a program on this computer'
}

/** The text Copy report puts on the clipboard: names, states, timings, hosts. Nothing else. */
export function connectorReport(connectors: readonly PublicConnector[], now: Date = new Date()): string {
  const lines = [`Locust connector report, ${now.toISOString()}`]
  const checked = connectors.find((connector) => connector.checkedInMs !== undefined)?.checkedInMs
  if (checked !== undefined) lines.push(`Last check took ${(checked / 1000).toFixed(1)} s.`)
  if (connectors.length === 0) lines.push('No connectors found.')
  for (const connector of connectors) {
    const words = connectorStateWords(connector)
    lines.push(`- ${connector.name} (${connectorWhere(connector.location)}): ${words.state}. ${lastWorked(connector, now)}`)
  }
  return lines.join('\n')
}
