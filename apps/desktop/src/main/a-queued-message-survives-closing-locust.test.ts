// Colin: "Keep the queue beside its conversation in the profile, and on reopen show it back in the box's queue with Edit/Discard. Never send it unasked after a relaunch: the person presses Send."
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createQueuedMessageStore } from './queued-message-store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function profile() { const root = await mkdtemp(join(tmpdir(), 'locust-durable-queue-')); roots.push(root); return root }
const row = { id: 'q_one', key: 'run_one', text: 'Check the second paragraph.', attachments: ['notes/context.md'] }

it('A fresh reader recovers exact words, attachments and their conversation.', async () => {
  const root = await profile()
  await createQueuedMessageStore(root).replace([row, { ...row, id: 'q_two', key: 'run_two', text: 'Another conversation.' }])
  expect(await createQueuedMessageStore(root).list()).toEqual([row, { ...row, id: 'q_two', key: 'run_two', text: 'Another conversation.' }])
})
it('A profile that has never queued anything starts empty.', async () => {
  expect(await createQueuedMessageStore(await profile()).list()).toEqual([])
})
it('Removing one conversation leaves the other queued after reopening.', async () => {
  const root = await profile()
  const store = createQueuedMessageStore(root)
  const other = { ...row, id: 'q_other', key: 'run_other' }
  await store.replace([row, other]); await store.replace([other])
  expect(await createQueuedMessageStore(root).list()).toEqual([other])
})
it('Concurrent writes and a shutdown flush preserve their invocation order.', async () => {
  const root = await profile()
  const store = createQueuedMessageStore(root)
  const first = store.replace([row])
  const last = store.replace([{ ...row, text: 'The edited words.' }])
  await store.flush(); await Promise.all([first, last])
  expect(await createQueuedMessageStore(root).list()).toEqual([{ ...row, text: 'The edited words.' }])
})
it('A truncated queue is reported and kept instead of overwritten with emptiness.', async () => {
  const root = await profile()
  const path = join(root, 'queued-messages.json')
  await writeFile(path, '{"schemaVersion":1,"rows":[', 'utf8')
  const store = createQueuedMessageStore(root)
  await expect(store.list()).rejects.toThrow()
  await expect(store.replace([])).rejects.toThrow()
  expect(await readFile(path, 'utf8')).toBe('{"schemaVersion":1,"rows":[')
})
it('Invalid input cannot replace previously saved words.', async () => {
  const root = await profile()
  const store = createQueuedMessageStore(root)
  await store.replace([row])
  for (const bad of [[{ ...row, key: '../escape' }], [{ ...row, text: '' }], [{ ...row, text: 'x'.repeat(8001) }], [{ ...row, attachments: [42] }], Array(257).fill(row)]) {
    await expect(store.replace(bad)).rejects.toThrow()
  }
  expect(await createQueuedMessageStore(root).list()).toEqual([row])
})
it('An unknown schema stays on disk for recovery.', async () => {
  const root = await profile()
  const text = JSON.stringify({ schemaVersion: 2, rows: [row] })
  await writeFile(join(root, 'queued-messages.json'), text)
  await expect(createQueuedMessageStore(root).replace([])).rejects.toThrow()
  expect(await readFile(join(root, 'queued-messages.json'), 'utf8')).toBe(text)
})
it('Read and write project only message fields and never runtime authority.', async () => {
  const root = await profile()
  const store = createQueuedMessageStore(root)
  await store.replace([{ ...row, restored: false, retryAt: 1, origin: 'host', command: 'run me' }])
  expect(await createQueuedMessageStore(root).list()).toEqual([row])
})
it('A message queued before the start receipt can be saved and then rekeyed.', async () => {
  const root = await profile()
  const store = createQueuedMessageStore(root)
  await store.replace([{ ...row, key: 'pending:1' }])
  expect(await store.list()).toEqual([{ ...row, key: 'pending:1' }])
  await store.replace([row])
  expect(await createQueuedMessageStore(root).list()).toEqual([row])
})
