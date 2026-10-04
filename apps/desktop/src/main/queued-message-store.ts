import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { savedQueuedMessages } from '../shared/queued-messages.js'
import type { SavedQueuedMessage } from '../shared/queued-messages.js'

const MAX_BYTES = 4 * 1024 * 1024

/** Atomic replacement, serialized with reads; a damaged file is never overwritten. */
export function createQueuedMessageStore(root: string) {
  const path = join(root, 'queued-messages.json')
  let tail: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work)
    tail = next.catch(() => undefined)
    return next
  }
  const read = async (): Promise<readonly SavedQueuedMessage[]> => {
    let file
    try { file = await open(path, 'r') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    try {
      if ((await file.stat()).size > MAX_BYTES) throw new Error('Queue too large')
      const value: unknown = JSON.parse(await file.readFile('utf8'))
      if (typeof value !== 'object' || value === null) throw new Error('Invalid queue file')
      const record = value as Record<string, unknown>
      if (record.schemaVersion !== 1) throw new Error('Invalid queue version')
      return savedQueuedMessages(record.rows)
    } finally { await file.close() }
  }
  return {
    list: () => serial(read),
    replace: (value: unknown) => serial(async () => {
      const rows = savedQueuedMessages(value)
      const text = JSON.stringify({ schemaVersion: 1, rows })
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Queue too large')
      await read() // Refuse to overwrite an unreadable file.
      await mkdir(root, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(text, 'utf8'); await file.sync() } finally { await file.close() }
        await rename(temporary, path)
        // Catch a failed replacement rather than acknowledging an absent file.
        await stat(path)
      } finally { await unlink(temporary).catch(() => undefined) }
      return rows
    }),
    flush: async () => { await tail }
  }
}
