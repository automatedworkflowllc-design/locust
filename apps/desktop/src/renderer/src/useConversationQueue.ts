import { useEffect, useRef, useState } from 'react'
import { createConversationQueue } from './conversationQueue.js'
import type { QueuedRow } from './steering.js'

export function useConversationQueue() {
  const [rows, setRows] = useState<readonly QueuedRow[]>([])
  const [error, setError] = useState<string>()
  const queue = useRef<ReturnType<typeof createConversationQueue> | undefined>(undefined)
  useEffect(() => {
    const bridge = window.desktop
    if (bridge?.readQueuedMessages === undefined) return
    let active = true
    queue.current = createConversationQueue({
      read: () => bridge.readQueuedMessages(),
      write: (value) => bridge.writeQueuedMessages(value)
    }, (next, message) => { if (active) { setRows(next); setError(message) } })
    return () => { active = false }
  }, [])
  const update = (change: readonly QueuedRow[] | ((before: readonly QueuedRow[]) => readonly QueuedRow[])): Promise<boolean> =>
    queue.current?.update(change) ?? Promise.resolve(false)
  const send = (key: string, dispatch: (row: QueuedRow) => Promise<boolean>): Promise<boolean> =>
    queue.current?.send(key, dispatch) ?? Promise.resolve(false)
  return [rows, update, error, send] as const
}
