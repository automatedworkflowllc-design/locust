/** Person-written follow-ups, beside the profile's conversation ledger. */
export interface SavedQueuedMessage {
  readonly id: string
  readonly key: string
  readonly text: string
  readonly attachments?: readonly string[]
}

export const QUEUED_MESSAGES_READ_CHANNEL = 'queued-messages:read'
export const QUEUED_MESSAGES_WRITE_CHANNEL = 'queued-messages:write'
export type QueuedMessagesResponse =
  | { readonly ok: true; readonly rows: readonly SavedQueuedMessage[] }
  | { readonly ok: false; readonly message: string }

/** Strict, bounded profile/IPC input; never silently truncate someone's words. */
export function savedQueuedMessages(value: unknown): readonly SavedQueuedMessage[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error('Invalid queue')
  return value.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid queue row')
    const row = entry as Record<string, unknown>
    if (typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 256
      || typeof row.key !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(row.key)
      || typeof row.text !== 'string' || row.text.trim().length === 0 || row.text.length > 8_000) {
      throw new Error('Invalid queue row')
    }
    if (row.attachments !== undefined && (!Array.isArray(row.attachments) || row.attachments.length > 32
      || !row.attachments.every((path: unknown) => typeof path === 'string' && path.length > 0 && path.length <= 4096))) {
      throw new Error('Invalid queue attachments')
    }
    return {
      id: row.id, key: row.key, text: row.text,
      ...(row.attachments === undefined ? {} : { attachments: row.attachments as readonly string[] })
    }
  })
}
