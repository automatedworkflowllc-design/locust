// Does a running Codex turn take `turn/steer` (A2.10)? Measured on the real
// `codex app-server`, one short read-only turn on the cheapest model.
//
//   node _tools/probe-codex-steer.mjs [--model <id>] [--effort low]
//
// The turn is asked to count slowly to 30, one number per line. After its
// first words arrive, the host steers in: "also end with the word PINEAPPLE".
// The turn must not be stopped, and its final message must carry the word.
// SPENDS one short turn on the person's Codex account.

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const model = arg('--model', 'gpt-5.6-luna')
const effort = arg('--effort', 'low')
const cwd = await mkdtemp(join(tmpdir(), 'locust-steer-'))

const child = spawn('codex', ['app-server'], { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
let buffer = ''
let nextId = 0
const pending = new Map()
const events = []
let text = ''
let threadId
let turnId
let steerSent = false
let steerAnswer
let done
const finished = new Promise((resolve) => { done = resolve })
const send = (method, params) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
})
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let at
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line.length === 0) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      continue
    }
    if (message.id !== undefined && message.method !== undefined) {
      // A request from the server (an approval): refuse it; the turn is read-only.
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { decision: 'decline' } })}\n`)
      continue
    }
    const method = message.method
    events.push(method)
    if (method === 'turn/started') turnId = message.params?.turn?.id ?? turnId
    if (method === 'item/agentMessage/delta') {
      text += message.params?.delta ?? ''
      if (!steerSent && text.length > 0 && turnId !== undefined) {
        steerSent = true
        send('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          input: [{ type: 'text', text: 'Also: end your answer with the single word PINEAPPLE on its own line.' }]
        }).then((result) => { steerAnswer = { ok: true, result } }, (error) => { steerAnswer = { ok: false, error: String(error.message) } })
      }
    }
    if (method === 'turn/completed') done(message.params)
  }
})
child.stderr.on('data', () => undefined)

const timer = setTimeout(() => done({ timedOut: true }), 180_000)
try {
  await send('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
  const thread = await send('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never' })
  threadId = thread?.thread?.id
  const started = await send('turn/start', {
    threadId,
    approvalPolicy: 'never',
    input: [{ type: 'text', text: 'Count from 1 to 30, one number per line, and nothing else. Do not use any tools.' }],
    model,
    effort
  })
  turnId = started?.turn?.id ?? turnId
  const end = await finished
  clearTimeout(timer)
  const status = end?.turn?.status ?? (end?.timedOut ? 'timed out' : 'unknown')
  const took = /PINEAPPLE/.test(text)
  console.log(`model ${model} / ${effort}; thread ${String(threadId)}; turn ${String(turnId)}`)
  console.log(`steer sent: ${String(steerSent)}; server answered: ${JSON.stringify(steerAnswer)}`)
  console.log(`turn ended: ${status}; interrupted events: ${events.filter((e) => /interrupt/i.test(e)).length}`)
  console.log(`final text (last 120 chars): ${JSON.stringify(text.slice(-120))}`)
  console.log(took && status === 'completed' ? '\nSTEER TAKEN MID-TURN' : '\nSTEER NOT SHOWN IN THE ANSWER')
} catch (error) {
  console.log(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  clearTimeout(timer)
  child.kill()
  setTimeout(() => process.exit(0), 500)
}
