import type { PublicAgentCapabilities } from '../../shared/ipc.js'

/**
 * WHAT AN ACP AGENT SAID IT CAN DO, IN WORDS (W12, 0.566), for its row in
 * Settings > AI agents. The agent's own answer, at its last run -- so the row
 * says "said", and when. Only the things a person would recognise; nothing
 * here is something Locust turns on.
 */
const LINES: ReadonlyArray<readonly [keyof Omit<PublicAgentCapabilities, 'toldAt'>, string]> = [
  ['continuesSessions', 'Can continue an earlier session'],
  ['images', 'Takes pictures in a message'],
  ['audio', 'Takes sound in a message'],
  ['embeddedContext', 'Takes a file’s contents in a message'],
  ['mcpOverHttp', 'Connects to connectors over the web (HTTP)'],
  ['mcpOverSse', 'Connects to connectors over SSE']
]

export function agentCapabilityLines(capabilities: PublicAgentCapabilities): readonly string[] {
  return LINES.map(([key, label]) => `${label}: ${capabilities[key] ? 'yes' : 'no'}`)
}

export function agentCapabilityHeading(name: string, capabilities: PublicAgentCapabilities, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - Date.parse(capabilities.toldAt)) / 86_400_000)
  const when = Number.isNaN(days) ? 'at its last run' : days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${String(days)} days ago`
  return `What ${name} said it can do (${when}):`
}
