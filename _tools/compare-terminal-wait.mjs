/** Screen labels alone cannot settle a comparison: after a reload a live
 * ledger used to read "interrupted" before the runtime had said anything.
 * Wait for an actual terminal receipt in every column, with a free-tier bound.
 */
export async function waitForCompareTerminals(read, {
  timeoutMs = 15 * 60_000, everyMs = 3000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const deadline = now() + timeoutMs
  let last
  for (;;) {
    last = await read()
    const shownTerminal = last.shown.states?.length === 2 && last.shown.states.every(state => ['done', 'failed', 'stopped', 'could not start'].includes(state))
    if (shownTerminal && last.columns.length === 2 && last.columns.every(column => column.terminal || column.refused)) return last.shown
    if (now() >= deadline) throw new Error(`still running: comparison has no terminal receipt in every column after ${timeoutMs}ms; ${JSON.stringify(last)}`)
    await sleep(Math.min(everyMs, Math.max(0, deadline - now())))
  }
}
