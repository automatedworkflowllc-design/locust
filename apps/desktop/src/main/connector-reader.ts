import { parseClaudeConnectors } from '@teammate/runtime-adapters'
import type { ClaudeConnector } from '@teammate/runtime-adapters'

/**
 * Which connectors this machine has, so every teammate can use them.
 *
 * Colin, 2026-09-10: "honestly just let them have access to the mcp tools if
 * the client have access to it -- it only makes sense and is way less muddy."
 * So there is no per-teammate list to tick: what the person's Claude Code can
 * reach, their teammates can reach.
 *
 * The names matter because an allow rule must NAME its server -- `mcp__*` is
 * refused -- and the account connectors from claude.ai never appear in
 * `~/.claude.json`, so they cannot be read off disk. `claude mcp list` prints
 * them, and is the only source that has all of them.
 *
 * It is also SLOW, because it health-checks every server: measured at several
 * seconds on 2026-09-09. So it is read in the background and cached, and a
 * run never waits for it. A first run that starts before the first read
 * finishes gets no rules and its connector calls are refused -- which is the
 * behaviour of every build before today, said plainly on screen, rather than
 * a mission that sits still for five seconds.
 */

/** How long a reading stands before it is taken again. */
const TTL_MS = 5 * 60_000
/** A read that has not answered by here is not going to help this run. */
const TIMEOUT_MS = 20_000

export interface ConnectorReader {
  /** Every connector name, for the allow rules. Never throws, never waits. */
  names(): readonly string[]
  /** The full reading, for anything that wants to show it. */
  current(): readonly ClaudeConnector[]
  /** Take a reading if the held one is stale. Returns when that one settles. */
  refresh(): Promise<readonly ClaudeConnector[]>
}

export function createConnectorReader(options: {
  /**
   * Run `mcp list` on the person's Claude Code and hand back what it printed.
   * Undefined when there is no Claude Code to ask, which is not a failure.
   */
  readonly read: (timeoutMs: number) => Promise<string | undefined>
  readonly now?: () => number
  readonly ttlMs?: number
}): ConnectorReader {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? TTL_MS
  let held: readonly ClaudeConnector[] = []
  let takenAt: number | undefined
  let inFlight: Promise<readonly ClaudeConnector[]> | undefined

  const take = async (): Promise<readonly ClaudeConnector[]> => {
    try {
      const text = await options.read(TIMEOUT_MS)
      // A read that could not run leaves the last good reading alone. A
      // Claude Code that is briefly busy should not empty the list and
      // silently take everyone's connectors away mid-session.
      if (text === undefined) return held
      held = parseClaudeConnectors(text)
      takenAt = now()
      return held
    } catch {
      return held
    } finally {
      inFlight = undefined
    }
  }

  return {
    names() {
      // Only the ones that answered. A server the person has not finished
      // signing into would produce a rule for tools that are not there.
      return held.filter((entry) => entry.status === 'connected').map((entry) => entry.name)
    },
    current() {
      return held
    },
    refresh() {
      if (takenAt !== undefined && now() - takenAt < ttl) return Promise.resolve(held)
      inFlight ??= take()
      return inFlight
    }
  }
}
