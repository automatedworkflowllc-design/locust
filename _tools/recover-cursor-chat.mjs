// Read back a conversation that ran on Cursor, from CURSOR's own store.
//
//   node _tools/recover-cursor-chat.mjs --find "Overnight Roth"
//   node _tools/recover-cursor-chat.mjs --session <uuid>
//   node _tools/recover-cursor-chat.mjs --find "AADX" --out recovered.md
//
// WHY THIS EXISTS. A Locust mission ledger is the durable record, and
// deleting a conversation removes it for good -- `unlinkSync`, no Recycle
// Bin, no undo. That is the product's stated behaviour. But a mission that
// RAN ON CURSOR also exists in Cursor's own transcript store, keyed by the
// same session id Locust records as `runtimeThreadId`:
//
//   ~/.cursor/chats/<workspace-hash>/<session-uuid>/store.db
//
// A sqlite file with one `blobs` table; each row's `data` is the bytes of a
// JSON message ({role, content}) or an internal record that is not JSON.
// This reads the JSON ones in order and writes the conversation back out.
//
// Cursor's own files are never written: each store is COPIED to a temp
// directory with its `-wal`, and the copy is what gets opened. Written
// 2026-09-17, after eighteen of Colin's missions were deleted through the
// app's own delete path and the ledgers were gone.

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, existsSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CHATS = join(homedir(), '.cursor', 'chats').replace(/\\/g, '/')
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const find = arg('--find')
const session = arg('--session')
const out = arg('--out')
if (find === undefined && session === undefined) {
  console.error('Give --find "<text>" or --session <uuid>.')
  process.exit(1)
}

/** Every session directory, newest first by its store's mtime. */
function sessions() {
  const found = []
  for (const workspace of readdirSync(CHATS)) {
    const dir = join(CHATS, workspace)
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const id of entries) {
      const store = join(dir, id, 'store.db')
      if (existsSync(store)) found.push({ workspace, id, store })
    }
  }
  return found
}

/**
 * The messages in one store, in the order they were written.
 *
 * Two things this has to get right, both of which cost an attempt:
 *
 * - `data` arrives as a Uint8Array, and `String(uint8array)` is the bytes
 *   printed as comma-separated NUMBERS ("123,34,114,..."), which parses as
 *   nothing and looks exactly like an unreadable store. `Buffer.from` is the
 *   whole fix.
 * - The newest messages are usually still in the WAL, and a readOnly open
 *   does not replay it -- the session that mattered read as empty while the
 *   text was plainly in the file. So the store is COPIED, with its `-wal`
 *   and `-shm`, and the copy is opened normally. Cursor's own file is never
 *   opened for writing.
 */
function messagesOf(store) {
  const room = mkdtempSync(join(tmpdir(), 'locust-recover-'))
  const copy = join(room, 'store.db')
  try {
    copyFileSync(store, copy)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(store + suffix)) copyFileSync(store + suffix, copy + suffix)
    }
  } catch {
    return []
  }
  let db
  try {
    db = new DatabaseSync(copy)
  } catch {
    return []
  }
  let rows = []
  try {
    rows = db.prepare('select data from blobs').all()
  } catch {
    return []
  }
  const messages = []
  for (const row of rows) {
    const data = row.data
    if (data === null || data === undefined) continue
    const text = Buffer.from(data).toString('utf8')
    if (!text.startsWith('{')) continue
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (typeof parsed?.role !== 'string') continue
    const content = typeof parsed.content === 'string'
      ? parsed.content
      : Array.isArray(parsed.content)
        ? parsed.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
        : ''
    if (content.length === 0) continue
    messages.push({ role: parsed.role, content })
  }
  return messages
}

const NL = String.fromCharCode(10)
const lines = []
let hits = 0
for (const entry of sessions()) {
  if (session !== undefined && entry.id !== session) continue
  const messages = messagesOf(entry.store)
  if (messages.length === 0) continue
  if (find !== undefined && !messages.some((message) => message.content.includes(find))) continue
  hits += 1
  lines.push(`## Session ${entry.id}`, '', `Workspace ${entry.workspace} · ${String(messages.length)} messages`, '')
  for (const message of messages) {
    // The system prompt is the harness, not the conversation.
    if (message.role === 'system') continue
    lines.push(`### ${message.role}`, '', message.content.trim(), '')
  }
}

if (hits === 0) {
  console.error('Nothing matched.')
  process.exit(1)
}
const text = lines.join(NL)
if (out === undefined) {
  console.log(text.slice(0, 4000))
  console.error(`${String(hits)} session(s); ${String(text.length)} characters. Use --out <file> for all of it.`)
} else {
  writeFileSync(out, text, 'utf8')
  console.error(`${String(hits)} session(s) written to ${out} (${String(text.length)} characters).`)
}
