// Two B4 leads on Codex's app-server, captured rather than argued about.
//
//   node _tools/probe-codex-resume-and-subagent.mjs [--model <id>] [--effort low] [--out <file>]
//
// Lead 11: the receipt takes `thread/tokenUsage/updated`'s `total`. On a
// RESUMED thread, does `total` start from the earlier turns (so a one-line
// turn reports the whole conversation), or from zero?
//
// Lead 1: when a turn spawns a sub-agent, do the sub-agent's own
// `thread/started` / `turn/completed` arrive on the same connection? The
// normalizer ends the run on the first `turn/completed` it sees and takes a
// thread id from `thread/started` without checking whose.
//
// Every notification is written to --out as JSONL, with the thread id it
// names. SPENDS three short turns on the person's Codex account (cheapest
// model, low effort by default).

import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const model = arg('--model', 'gpt-5.6-luna')
const effort = arg('--effort', 'low')
const out = arg('--out', join(tmpdir(), 'codex-resume-subagent.jsonl'))
writeFileSync(out, '')
const cwd = await mkdtemp(join(tmpdir(), 'locust-codex-leads-'))
const log = (entry) => appendFileSync(out, `${JSON.stringify(entry)}\n`)

/** One app-server process: send requests, collect notifications until a turn ends. */
function session(label) {
  const child = spawn('codex', ['app-server'], { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let nextId = 0
  const pending = new Map()
  const listeners = []
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
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { decision: 'decline' } })}\n`)
        continue
      }
      const params = message.params ?? {}
      const threadId = params.threadId ?? params.thread?.id ?? params.turn?.threadId
      const usage = message.method === 'thread/tokenUsage/updated' ? params.tokenUsage : undefined
      log({
        session: label,
        method: message.method,
        threadId,
        ...(params.turn?.id === undefined ? {} : { turnId: params.turn.id }),
        ...(params.item?.type === undefined ? {} : { itemType: params.item.type, itemTool: params.item.tool }),
        ...(usage === undefined ? {} : { total: usage.total, last: usage.last })
      })
      for (const listen of listeners) listen(message)
    }
  })
  child.stderr.on('data', () => undefined)
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  const until = (predicate, ms = 240_000) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms)
    listeners.push((message) => { if (predicate(message)) { clearTimeout(timer); resolve(message) } })
  })
  const init = async () => {
    await send('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
  }
  return { send, until, init, close: () => child.kill() }
}

const turn = async (s, threadId, text) => {
  const started = await s.send('turn/start', { threadId, approvalPolicy: 'never', input: [{ type: 'text', text }], model, effort })
  const turnId = started?.turn?.id
  const end = await s.until((m) => m.method === 'turn/completed' && (m.params?.turn?.id === turnId || turnId === undefined))
  return { turnId, status: end?.params?.turn?.status ?? (end?.timedOut ? 'timed out' : 'unknown') }
}

try {
  // Lead 11: one turn, then the same thread resumed in a new process.
  const a = session('first')
  await a.init()
  const thread = await a.send('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never' })
  const threadId = thread?.thread?.id
  const first = await turn(a, threadId, 'Reply with exactly: ONE')
  a.close()
  const b = session('resumed')
  await b.init()
  const resumed = await b.send('thread/resume', { threadId })
  log({ session: 'resumed', method: 'thread/resume (response)', threadId, tokenUsage: resumed?.thread?.tokenUsage ?? resumed?.tokenUsage })
  const second = await turn(b, threadId, 'Reply with exactly: TWO')
  b.close()
  console.log(`lead 11: thread ${String(threadId)}; first turn ${first.status}, resumed turn ${second.status}`)

  // Lead 1: a turn asked to spawn one sub-agent.
  const c = session('subagent')
  await c.init()
  const parent = await c.send('thread/start', { cwd, sandbox: 'read-only', approvalPolicy: 'never' })
  const parentId = parent?.thread?.id
  const spawned = await turn(c, parentId, 'Use your tool for starting a sub-agent to start exactly one helper whose only job is to reply with the word PING. Wait for it to finish, then tell me in one line what it said.')
  c.close()
  console.log(`lead 1: parent thread ${String(parentId)}; turn ${spawned.status}`)
} catch (error) {
  console.log(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  console.log(`notifications: ${out}`)
  setTimeout(() => process.exit(0), 800)
}
