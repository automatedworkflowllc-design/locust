import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

/**
 * The rest of the sweep never waits for Antigravity.
 *
 * Antigravity's check asks a CLI that fetches its model list over the network,
 * and the sweep used to be `Promise.all([everyoneElse, antigravity])`: the
 * sweep's answer, the first screen (it closes when the sweep finishes) and
 * every Send that needed a sweep were as slow as the slowest of them, and a
 * hung `agy` made all of them wait for it (Colin, 2026-10-05: "antigravitys
 * start up probe seemed like it took a pretty long time").
 *
 * So: the others' answers are the sweep. If Antigravity has answered by the
 * time they have, its answer is in the sweep. If it has not, the sweep says
 * what is true -- installed, not answered yet (`pending`) -- and goes on; its
 * answer is handed to `late` when it lands, which puts it where the next read
 * finds it.
 *
 * Nothing here is ever a stale answer shown as fresh: `pending` claims nothing
 * about signing in, and `late` is only ever this check's own answer.
 */
export async function besideTheOthers<T>(
  others: Promise<readonly T[]>,
  antigravity: Promise<RuntimeDiscovery | undefined>,
  options: {
    /** What to show for Antigravity when its check has not finished. */
    readonly pending: () => RuntimeDiscovery
    /** Antigravity answered after the sweep had already gone on without it. */
    readonly late: (answer: RuntimeDiscovery) => void
  }
): Promise<{ readonly others: readonly T[]; readonly antigravity: RuntimeDiscovery | undefined; readonly leftBehind: boolean }> {
  let answered = false
  let answer: RuntimeDiscovery | undefined
  let gone = false
  const settled = antigravity
    .then((value) => {
      answered = true
      answer = value
      if (gone && value !== undefined) options.late(value)
    })
    .catch(() => {
      answered = true
    })
  const rest = await others
  if (answered) return { others: rest, antigravity: answer, leftBehind: false }
  gone = true
  // The check carries on; `late` hears of it. Nothing to await.
  void settled
  return { others: rest, antigravity: options.pending(), leftBehind: true }
}
