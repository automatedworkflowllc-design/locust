import type { QueuedMessagesResponse } from '../../shared/queued-messages.js'
import type { QueuedRow } from './steering.js'
import { takeNext } from './steering.js'

export { QUEUE_RESTORED_NOTE } from './steering.js'

/** Disk acknowledgement precedes UI acknowledgement; reads never race the first edit. */
export function createConversationQueue(io: {
  read(): Promise<QueuedMessagesResponse>
  write(rows: readonly QueuedRow[]): Promise<QueuedMessagesResponse>
}, changed: (rows: readonly QueuedRow[], error?: string) => void) {
  let rows: readonly QueuedRow[] = []
  let readable = false
  let sending = false
  let tail: Promise<unknown> = io.read().then((answer) => {
    if (!answer.ok) { changed(rows, answer.message); return }
    rows = answer.rows.map((row) => ({ ...row, origin: 'person', restored: true }))
    readable = true
    changed(rows)
  }).catch(() => { changed(rows, 'Saved messages could not be read. Reopen Locust to try again; the saved file has been kept.') })
  const queue = {
    update(change: readonly QueuedRow[] | ((before: readonly QueuedRow[]) => readonly QueuedRow[])): Promise<boolean> {
      const next = tail.then(async () => {
        if (!readable) return false
        const after = typeof change === 'function' ? change(rows) : change
        try {
          const answer = await io.write(after.filter((row) => row.origin === 'person'))
          if (!answer.ok) { changed(rows, answer.message); return false }
          rows = after
          changed(rows)
          return true
        } catch {
          changed(rows, 'This queue change was not saved. Your queued messages are still here; try again.')
          return false
        }
      })
      tail = next.catch(() => undefined)
      return next
    },
    ready: () => tail
  }
  return {
    ...queue,
    async send(key: string, dispatch: (row: QueuedRow) => Promise<boolean>): Promise<boolean> {
      if (sending) return false
      sending = true
      let going: QueuedRow | undefined
      let removed: readonly QueuedRow[] = []
      try {
        const saved = await queue.update((before) => {
          const next = takeNext(before, key)
          going = next.going
          const kept = new Set(next.rest)
          removed = before.filter((row) => !kept.has(row))
          return next.rest
        })
        if (!saved || going === undefined) return false
        let sent = false
        try { sent = await dispatch(going) } catch { /* Not acknowledged: offer the words back. */ }
        if (!sent) await queue.update((before) => [...removed.map((row) => ({ ...row, held: 'not sent — press Send to try again' })), ...before])
        return sent
      } finally { sending = false }
    }
  }
}
