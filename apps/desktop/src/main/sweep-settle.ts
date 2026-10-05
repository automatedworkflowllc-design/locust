import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

/**
 * The sweep waits for the agents that answer quickly, and for nobody else.
 *
 * It used to answer when the SLOWEST agent had: `Promise.all` over every
 * check. The sweep's answer, the first screen (it closes when the sweep
 * finishes) and every Send that needed a sweep were as slow as that one agent.
 * Antigravity went first (0.628: its check no longer holds anything up); this
 * is the same rule for every agent, because the slowest one is whoever it is
 * that launch -- measured 2026-10-05, 0.627 package, three launches on Colin's
 * machine: OpenCode 5.3 s, 3.2 s, 11.5 s, and the app on screen at 7.5, 5.3
 * and 12.9 s, each launch waiting for it.
 *
 * So: the sweep is released when every check has answered or when
 * `deadlineMs` has passed, whichever is first. An agent that answered is in the
 * sweep as itself. An agent that has not is in the sweep as what is true --
 * installed, still being checked (`pending`) -- and its check carries on; its
 * answer is handed to `late` when it lands, once, so it can be put where the
 * next read finds it. Nothing here guesses: `pending` claims nothing about
 * signing in, and `late` is only ever that check's own answer.
 */
export interface SweepCheck {
  readonly id: string
  /** The agent's answer; undefined when it has none to give (it is left out of the sweep). */
  readonly result: Promise<RuntimeDiscovery | undefined>
  /** Settles once it is known whether the agent is installed -- a PATH search, not a probe. */
  readonly located: Promise<void>
  /** What to show for the agent while its check is going. Asked only after `located`. */
  readonly pending: () => RuntimeDiscovery
}

export interface Settled {
  /** Every agent that is in the sweep, in the order the checks were given. */
  readonly answers: readonly RuntimeDiscovery[]
  /** The agents shown as still being checked, each with the check that is still going. */
  readonly left: ReadonlyMap<string, Promise<RuntimeDiscovery | undefined>>
}

/**
 * How long the first screen waits for agents, from the sweep starting.
 *
 * MEASURED on Colin's machine, 2026-10-05, from the start of the sweep, six
 * quiet launches each way: warm, Claude Code 0.6-0.9 s, Codex 0.5-0.9 s,
 * Antigravity 1.4-2.4 s, Cursor 2.1-2.7 s, OpenCode 2.6-3.5 s (the ones Locust
 * only lists, under 0.3 s); cold, Claude Code 0.7-1.1 s, Codex 1.1-1.6 s,
 * Antigravity 1.9-2.3 s, Cursor 3.3-4.7 s, OpenCode 4.4-6.0 s -- and 11.5 s in
 * the 0.627 measurement the handoff was written from. Two seconds is "the
 * time the fast ones take": the two agents most people run are in it with
 * room, Antigravity mostly is, and the first screen is no longer as late as
 * whichever tool is slowest that launch. The agents that are not in it are
 * shown as still being checked for the second or so they have left.
 */
export const FIRST_SCREEN_DEADLINE_MS = 2_000

/** Whether an answer is only the placeholder for a check that has not finished. */
export const isStillBeingChecked = (entry: RuntimeDiscovery): boolean =>
  entry.diagnostics?.some((note) => note.code === 'check-pending') === true

/**
 * A sweep that goes on without an agent which ANSWERED last time shows that
 * answer, not a blank.
 *
 * The first sweep has nothing to show for a slow agent but "installed, being
 * checked". Every later one does: the picker's model list is built from the
 * held answers, and a sweep after the ten-second cache -- every model-list read
 * is one -- that left Cursor "being checked" would have taken Cursor's models
 * out of the picker until the check finished. The agent's last definite answer
 * (ready, or needs signing in) stays until the new one replaces it; the check
 * carries on and `late` puts the fresh answer in. Never a guess: an agent with
 * no definite answer before is still shown as being checked.
 */
export function keepWhatWasAnswered(
  settled: Settled,
  before: readonly RuntimeDiscovery[]
): readonly RuntimeDiscovery[] {
  const last = new Map(before.map((entry) => [entry.id, entry]))
  return settled.answers.map((entry) => {
    if (!settled.left.has(entry.id)) return entry
    const was = last.get(entry.id)
    const definite = was !== undefined
      && was.availability === 'available'
      && (was.readiness === 'ready' || was.readiness === 'authentication-required')
      && !isStillBeingChecked(was)
    return definite ? was : entry
  })
}

export async function settleWithin(
  checks: readonly SweepCheck[],
  options: {
    readonly deadlineMs: number
    /**
     * An agent shown as pending has answered. Called once per agent, only for
     * agents that were left behind; `answer` is undefined if its check ended
     * without one.
     */
    readonly late: (id: string, answer: RuntimeDiscovery | undefined) => void
  }
): Promise<Settled> {
  const state = checks.map((check) => ({ check, done: false, gone: false, answer: undefined as RuntimeDiscovery | undefined }))
  const everyone = Promise.all(
    state.map((entry) =>
      entry.check.result.then(
        (value) => {
          entry.done = true
          entry.answer = value
          if (entry.gone) options.late(entry.check.id, value)
        },
        () => {
          entry.done = true
          if (entry.gone) options.late(entry.check.id, undefined)
        }
      )
    )
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      everyone,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.deadlineMs)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  // The only wait past the deadline: learning whether each agent is installed, which is a lookup.
  await Promise.all(state.filter((entry) => !entry.done).map((entry) => entry.check.located))

  const answers: RuntimeDiscovery[] = []
  const left = new Map<string, Promise<RuntimeDiscovery | undefined>>()
  for (const entry of state) {
    if (entry.done) {
      if (entry.answer !== undefined) answers.push(entry.answer)
      continue
    }
    // Decided here, synchronously with the check above: from now on it is left behind.
    entry.gone = true
    answers.push(entry.check.pending())
    left.set(entry.check.id, entry.check.result.catch(() => undefined))
  }
  return { answers, left }
}
