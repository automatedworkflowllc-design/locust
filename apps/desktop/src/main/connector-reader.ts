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
export const CONNECTOR_READ_TIMEOUT_MS = 20_000

/**
 * A connector as Settings shows it (W8, 0.567): the health check's class, and
 * `timed-out` when the last check hit the 20 s limit (the connectors are
 * those of the last reading that answered); how long that check took; when
 * each was last seen connected, kept in memory across readings.
 */
export interface ReadConnector extends Omit<ClaudeConnector, 'status'> {
  readonly status: ClaudeConnector['status'] | 'timed-out'
  readonly checkedInMs?: number
  readonly lastConnectedAt?: string
}

/** What the read said: the listing's text, `timed-out` at the limit, undefined when there is no Claude Code to ask. */
export type ConnectorRead = string | 'timed-out' | undefined

export interface ConnectorReader {
  /** Every connector name, for the allow rules. Never throws, never waits. Always the last reading that answered. */
  names(): readonly string[]
  /** The full reading, for anything that wants to show it. */
  current(): readonly ReadConnector[]
  /** Take a reading if the held one is stale. Returns when that one settles. */
  refresh(): Promise<readonly ReadConnector[]>
  /**
   * Count the held reading as stale (0.716): a connector was just added or
   * taken back, so the next look reads again -- and a read already under way
   * began before the change, so its answer is not taken as the new one.
   */
  forget(): void
}

export function createConnectorReader(options: {
  /**
   * Run `mcp list` on the person's Claude Code and hand back what it printed,
   * or `timed-out`. Undefined when there is no Claude Code to ask, which is
   * not a failure.
   */
  readonly read: (timeoutMs: number) => Promise<ConnectorRead>
  readonly now?: () => number
  readonly ttlMs?: number
}): ConnectorReader {
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? TTL_MS
  let held: readonly ClaudeConnector[] = []
  let takenAt: number | undefined
  let inFlight: Promise<readonly ReadConnector[]> | undefined
  // Bumped by forget(): a read begun before it answers for a list that has since changed.
  let generation = 0
  let lastCheck: { readonly ms: number; readonly timedOut: boolean } | undefined
  const lastConnected = new Map<string, number>()

  const view = (): readonly ReadConnector[] =>
    held.map((entry) => {
      const seen = lastConnected.get(entry.name)
      return {
        ...entry,
        ...(lastCheck?.timedOut === true ? { status: 'timed-out' as const } : {}),
        ...(lastCheck === undefined ? {} : { checkedInMs: lastCheck.ms }),
        ...(seen === undefined ? {} : { lastConnectedAt: new Date(seen).toISOString() })
      }
    })

  const take = async (): Promise<readonly ReadConnector[]> => {
    const began = now()
    const asked = generation
    try {
      const text = await options.read(CONNECTOR_READ_TIMEOUT_MS)
      if (asked !== generation) return view()
      // A read that could not run leaves the last good reading alone. A
      // Claude Code that is briefly busy should not empty the list and
      // silently take everyone's connectors away mid-session.
      if (text === undefined) return view()
      if (text === 'timed-out') {
        // Said, not hidden (W8): the rules keep the last good reading; Settings says it did not answer.
        lastCheck = { ms: now() - began, timedOut: true }
        takenAt = now()
        return view()
      }
      held = parseClaudeConnectors(text)
      takenAt = now()
      lastCheck = { ms: takenAt - began, timedOut: false }
      for (const entry of held) if (entry.status === 'connected') lastConnected.set(entry.name, takenAt)
      return view()
    } catch {
      return view()
    } finally {
      if (asked === generation) inFlight = undefined
    }
  }

  return {
    names() {
      // Only the ones that answered. A server the person has not finished
      // signing into would produce a rule for tools that are not there.
      return held.filter((entry) => entry.status === 'connected').map((entry) => entry.name)
    },
    current() {
      return view()
    },
    refresh() {
      if (takenAt !== undefined && now() - takenAt < ttl) return Promise.resolve(view())
      inFlight ??= take()
      return inFlight
    },
    forget() {
      generation += 1
      takenAt = undefined
      inFlight = undefined
    }
  }
}
