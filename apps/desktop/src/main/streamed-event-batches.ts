import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/** Text has a deadline from its FIRST fragment; activity never waits for it. */
export const STREAM_BATCH_MS = 50

/**
 * One durable write at a time. Read/normalize while it is in flight, keeping
 * the runner's existing backpressure bound. No event is merged or renumbered.
 * A non-delta makes everything ahead of it ready immediately. A final flush
 * drains both the in-flight write and any text waiting behind it.
 */
export function createStreamedEventBatcher(
  write: (events: readonly NormalizedRuntimeEvent[]) => Promise<void>,
  failed: (error: unknown) => void,
  windowMs = STREAM_BATCH_MS
): {
  push(events: readonly NormalizedRuntimeEvent[]): void
  flush(): Promise<void>
  readonly pendingCount: number
} {
  let waiting: NormalizedRuntimeEvent[] = []
  let writer: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ready = false
  let stopped = false

  const cancelTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const pump = (): void => {
    if (writer !== undefined || stopped || !ready || waiting.length === 0) return
    // Assign the promise before calling write, even if a test double throws
    // synchronously. Errors stop the run; they never become timer rejections.
    writer = Promise.resolve().then(async () => {
      while (ready && waiting.length > 0 && !stopped) {
        cancelTimer()
        const batch = waiting
        waiting = []
        ready = false
        await write(batch)
      }
    }).catch((error: unknown) => {
      stopped = true
      waiting = []
      cancelTimer()
      failed(error)
    }).finally(() => {
      writer = undefined
      pump()
    })
  }
  return {
    push(events) {
      if (stopped || events.length === 0) return
      waiting.push(...events)
      if (events.some((event) => event.type !== 'message.delta')) {
        ready = true
        cancelTimer()
        pump()
      } else if (!ready && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined
          ready = true
          pump()
        }, windowMs)
      }
    },
    async flush() {
      cancelTimer()
      while (!stopped && (waiting.length > 0 || writer !== undefined)) {
        ready = true
        pump()
        await writer
      }
      ready = false
    },
    get pendingCount() { return waiting.length }
  }
}
