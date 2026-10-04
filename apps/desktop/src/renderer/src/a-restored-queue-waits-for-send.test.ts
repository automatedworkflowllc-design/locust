// Colin: "Never send it unasked after a relaunch: the person presses Send."
import { expect, it } from 'vitest'
import { createConversationQueue, QUEUE_RESTORED_NOTE } from './conversationQueue.js'
import { combineQueued, queuedIn, queuedVerdict, requeuedRows, takeNext, withoutQueueOf } from './steering.js'
import type { QueuedRow } from './steering.js'
import type { QueuedMessagesResponse } from '../../shared/queued-messages.js'

const one: QueuedRow = { id: 'q_one', key: 'run_one', text: 'Check it.', origin: 'person', attachments: ['notes.md'] }
const other: QueuedRow = { id: 'q_other', key: 'run_other', text: 'Keep me.', origin: 'person' }
function fixture(saved: readonly QueuedRow[] = [one, other]) {
  let disk = saved
  let seen: readonly QueuedRow[] = []
  let error: string | undefined
  const io = {
    read: async (): Promise<QueuedMessagesResponse> => ({ ok: true, rows: disk }),
    write: async (rows: readonly QueuedRow[]): Promise<QueuedMessagesResponse> => { disk = rows; return { ok: true, rows } }
  }
  const queue = createConversationQueue(io, (rows, message) => { seen = rows; error = message })
  return { queue, io, seen: () => seen, disk: () => disk, error: () => error }
}
it('Restored messages wait for Send even when the previous turn completed.', async () => {
  const f = fixture(); await f.queue.ready()
  const first = f.seen()[0]!
  for (const phase of ['completed', 'interrupted', 'failed', 'cancelled', 'running', undefined]) {
    expect(queuedVerdict({ running: phase === 'running', phase, onScreen: true, restored: first.restored })).toEqual({ kind: 'held', note: QUEUE_RESTORED_NOTE })
  }
})
it('A newly queued message still sends when its turn completes in the same session.', async () => {
  const f = fixture([]); await f.queue.update((rows) => [...rows, one])
  expect(queuedVerdict({ running: false, phase: 'completed', onScreen: true, restored: f.seen()[0]?.restored }).kind).toBe('send')
})
it('Edit and Discard remove only their conversation durably.', async () => {
  const f = fixture(); await f.queue.ready()
  expect(queuedIn(f.seen(), 'run_one')[0]?.attachments).toEqual(['notes.md'])
  await f.queue.update((rows) => withoutQueueOf(rows, 'run_one'))
  expect(f.disk().map((row) => row.key)).toEqual(['run_other'])
  await f.queue.update((rows) => withoutQueueOf(rows, 'run_other'))
  expect(f.disk()).toEqual([])
})
it('An explicit Send takes the restored words and files without releasing another conversation.', async () => {
  const f = fixture(); await f.queue.ready()
  const { going, rest } = takeNext(f.seen(), 'run_one')
  expect(going).toMatchObject({ ...one, restored: true })
  expect(await f.queue.update(rest)).toBe(true)
  expect(f.disk().map((row) => row.key)).toEqual(['run_other'])
})
it('Rekeyed messages reopen under the acknowledged run instead of a temporary key.', async () => {
  const f = fixture([])
  await f.queue.update([one]); await f.queue.update((rows) => requeuedRows(rows, 'run_one', 'run_named'))
  const reopened = fixture(f.disk()); await reopened.queue.ready()
  expect(queuedIn(reopened.seen(), 'run_one')).toEqual([])
  expect(queuedIn(reopened.seen(), 'run_named')[0]).toMatchObject({ text: one.text, restored: true })
})
it('A new automatic queue row cannot absorb a restored message.', () => {
  expect(combineQueued([one, { ...one, id: 'restored', restored: true, attachments: [] }])).toHaveLength(2)
})
it('Queue edits wait for the initial read and do not erase saved conversations.', async () => {
  let release!: (value: QueuedMessagesResponse) => void
  let seen: readonly QueuedRow[] = []
  const queue = createConversationQueue({ read: () => new Promise((resolve) => { release = resolve }), write: async (rows) => ({ ok: true, rows }) }, (rows) => { seen = rows })
  const update = queue.update((rows) => [...rows, other])
  release({ ok: true, rows: [one] }); await update
  expect(seen.map((row) => row.key)).toEqual(['run_one', 'run_other'])
})
it('The UI does not acknowledge a queue change before the write succeeds.', async () => {
  const f = fixture([]); await f.queue.ready()
  let release!: (value: QueuedMessagesResponse) => void
  f.io.write = () => new Promise((resolve) => { release = resolve })
  const update = f.queue.update([one])
  await Promise.resolve()
  expect(f.seen()).toEqual([])
  release({ ok: true, rows: [one] }); expect(await update).toBe(true)
  expect(f.seen()).toEqual([one])
})
it('A failed write keeps the previous queue and reports that nothing changed.', async () => {
  const f = fixture(); await f.queue.ready()
  f.io.write = async () => { throw new Error('disk full') }
  expect(await f.queue.update([])).toBe(false)
  expect(f.seen()).toHaveLength(2)
  expect(f.error()).toContain('not saved')
})
it('An unreadable queue refuses updates instead of silently replacing saved words.', async () => {
  let writes = 0
  const queue = createConversationQueue({ read: async () => ({ ok: false, message: 'Read failed.' }), write: async (rows) => { writes++; return { ok: true, rows } } }, () => undefined)
  expect(await queue.update([one])).toBe(false)
  expect(writes).toBe(0)
})
it('Only person-written messages are persisted rather than host scheduling intents.', async () => {
  const f = fixture([])
  await f.queue.update([one, { ...other, origin: 'host' }])
  expect(f.seen()).toHaveLength(2)
  expect(f.disk()).toEqual([one])
})
it('Send durably removes its row before dispatch and leaves every other conversation held.', async () => {
  const f = fixture(); await f.queue.ready()
  expect(await f.queue.send('run_one', async (row) => {
    expect(row).toMatchObject({ ...one, restored: true })
    expect(f.disk().map((saved) => saved.key)).toEqual(['run_other'])
    return true
  })).toBe(true)
  expect(f.seen()[0]).toMatchObject({ key: 'run_other', restored: true })
})
it('Another queued Send waits while the first Send is still being acknowledged.', async () => {
  const f = fixture(); await f.queue.ready()
  let release!: (sent: boolean) => void
  let dispatched = 0
  const first = f.queue.send('run_one', async () => { dispatched++; return new Promise((resolve) => { release = resolve }) })
  expect(await f.queue.send('run_one', async () => { dispatched++; return true })).toBe(false)
  expect(await f.queue.send('run_other', async () => { dispatched++; return true })).toBe(false)
  // Allow the serialized disk write to reach dispatch.
  await f.queue.ready(); await Promise.resolve(); await Promise.resolve()
  release(true); expect(await first).toBe(true)
  expect(dispatched).toBe(1)
})
it('A refused Send offers the message back held rather than dropping or retrying it.', async () => {
  const f = fixture([]); await f.queue.update([one, other])
  expect(await f.queue.send('run_one', async () => false)).toBe(false)
  expect(f.disk()[0]).toMatchObject({ ...one, held: 'not sent — press Send to try again' })
  expect(queuedVerdict({ running: false, phase: 'completed', onScreen: true, held: f.seen()[0]?.held }).kind).toBe('held')
})
it('A failed removal write sends nothing and keeps the saved words.', async () => {
  const f = fixture(); await f.queue.ready()
  f.io.write = async () => ({ ok: false, message: 'No disk space; your words are still here.' })
  let sent = false
  expect(await f.queue.send('run_one', async () => { sent = true; return true })).toBe(false)
  expect(sent).toBe(false)
  expect(f.disk()).toHaveLength(2)
})
it('A refused folded message restores its original rows without exceeding the saved row limit.', async () => {
  const first = { ...one, attachments: [], text: 'a'.repeat(8_000) }
  const second = { ...first, id: 'q_second', text: 'b'.repeat(8_000) }
  const f = fixture([first, second]); await f.queue.ready()
  expect(await f.queue.send('run_one', async (folded) => {
    expect(folded.text.length).toBeGreaterThan(8_000)
    return false
  })).toBe(false)
  expect(f.disk().map((row) => row.text)).toEqual([first.text, second.text])
})
