// Does Codex app-server send a thought's summary, and where?
//
//   LOCUST_SPEND=1 node _tools/probe-codex-reasoning-summary.mjs [--summary auto|concise|detailed|none] [--effort medium]
//
// 0.492: a Codex thought reached the thread as a length only -- every
// reasoning item completed with `summary: []`, even with `summary: "auto"` on
// turn/start. This speaks the protocol directly and prints, per notification
// kind, how many arrived, and what each reasoning item and summary delta
// carried (lengths and the first words; never the item's raw `content`).
// Spends one small Codex turn.

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.env.LOCUST_SPEND !== '1') {
  console.log('refusing to run: this spends a Codex turn. Set LOCUST_SPEND=1.')
  process.exit(1)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const summary = arg('--summary') ?? 'auto'
const effort = arg('--effort') ?? 'medium'
const cwd = await mkdtemp(join(tmpdir(), 'locust-probe-summary-'))
const child = spawn('codex', ['app-server'], { cwd, shell: true, stdio: ['pipe', 'pipe', 'inherit'] })
let buffer = ''
let nextId = 1
const waiting = new Map()
const counts = new Map()
const notes = []
const send = (method, params) => {
  const id = nextId++
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
}
let done
const finished = new Promise((resolve) => { done = resolve })
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id !== undefined && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)
      waiting.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      continue
    }
    if (message.id !== undefined && message.method !== undefined) {
      // A request from the server (an approval): refuse it.
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { decision: 'decline' } })}\n`)
      continue
    }
    const method = message.method ?? '?'
    counts.set(method, (counts.get(method) ?? 0) + 1)
    const item = message.params?.item
    if (item?.type === 'reasoning' && method === 'item/completed') {
      notes.push(`reasoning completed: summary parts ${String(item.summary?.length ?? 0)} [${(item.summary ?? []).map((part) => JSON.stringify(part.slice(0, 50))).join(', ')}], content parts ${String(item.content?.length ?? 0)}`)
    }
    if (/summary/i.test(method)) notes.push(`${method}: ${JSON.stringify(message.params).slice(0, 160)}`)
    if (method === 'turn/completed') done()
  }
})
await send('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`)
const thread = await send('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never' })
await send('turn/start', {
  threadId: thread.thread.id,
  approvalPolicy: 'never',
  input: [{ type: 'text', text: 'Think it through before answering: which is larger, 17*23 or 19*21? Reply with the larger product only.' }],
  effort,
  ...(summary === 'omit' ? {} : { summary })
})
await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 180_000))])
console.log(`summary=${summary} effort=${effort}`)
for (const [method, count] of [...counts].sort()) console.log(`  ${String(count).padStart(4)}  ${method}`)
for (const note of notes.slice(0, 20)) console.log(`  ${note}`)
child.kill()
process.exit(0)
