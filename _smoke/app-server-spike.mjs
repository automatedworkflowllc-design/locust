// Spike: can we drive `codex app-server` end to end?
//
// This is the decisive experiment for the remaining third of the design. The
// `exec` transport has no approval channel, so approval cards, the question
// card, a real model list and mid-run steering are all blocked on this
// protocol being usable. Rather than plan around an assumption, drive it.
//
//   node _smoke/app-server-spike.mjs
//
// Prints the handshake, the notification stream for one turn, and a verdict.
// Read-only sandbox; it runs in a throwaway git repo and removes it.

import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CODEX = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e\\codex.exe'
const PROMPT = 'Reply with exactly SPIKE_OK and nothing else.'

const root = await mkdtemp(join(tmpdir(), 'locust-appserver-'))
execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
await writeFile(join(root, 'README.md'), 'scratch\n', 'utf8')

const child = spawn(CODEX, ['app-server'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
const stderr = []
child.stderr.on('data', (chunk) => stderr.push(String(chunk)))

let nextId = 0
const pending = new Map()
const notifications = []
const serverRequests = []
let buffer = ''

child.stdout.on('data', (chunk) => {
  buffer += String(chunk)
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
    if (line.length === 0) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id)
      if (waiter !== undefined) {
        pending.delete(message.id)
        waiter(message)
      }
      continue
    }
    if (message.id !== undefined && message.method !== undefined) {
      // Server -> client REQUEST: this is the approval channel `exec` lacks.
      serverRequests.push(message)
      continue
    }
    notifications.push(message)
  }
})

function send(method, params) {
  const id = ++nextId
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return Promise.race([
    new Promise((resolve) => pending.set(id, resolve)),
    new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 60_000))
  ])
}

const say = (line) => console.error(line)

try {
  say('1. initialize')
  const init = await send('initialize', {
    clientInfo: { name: 'locust-spike', title: 'Locust', version: '0.0.1' }
  })
  say(`   ${init.error ? `ERROR ${JSON.stringify(init.error).slice(0, 200)}` : 'ok'}`)
  if (init.error) throw new Error('initialize failed')
  say(`   capabilities: ${JSON.stringify(init.result ?? {}).slice(0, 300)}`)

  // Some servers require an initialized notification before other calls.
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`)

  say('2. thread/start')
  const thread = await send('thread/start', { cwd: root, sandbox: 'read-only' })
  say(`   ${thread.error ? `ERROR ${JSON.stringify(thread.error).slice(0, 300)}` : JSON.stringify(thread.result).slice(0, 200)}`)
  const threadId = thread.result?.threadId ?? thread.result?.thread?.id
  if (threadId === undefined) throw new Error('no threadId')

  say('3. model/list')
  const models = await send('model/list', {})
  const list = models.result?.data ?? []
  say(`   ${list.length} models`)
  for (const entry of list.slice(0, 10)) {
    const efforts = (entry.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort).join('/')
    say(`     ${entry.id}  efforts: ${efforts || 'none'}`)
  }

  say('4. turn/start')
  const turn = await send('turn/start', {
    threadId,
    input: [{ type: 'text', text: PROMPT }]
  })
  say(`   ${turn.error ? `ERROR ${JSON.stringify(turn.error).slice(0, 300)}` : 'accepted'}`)

  await new Promise((resolve) => setTimeout(resolve, 25_000))

  const kinds = new Map()
  for (const message of notifications) {
    kinds.set(message.method, (kinds.get(message.method) ?? 0) + 1)
  }
  say('\n5. notifications received')
  for (const [method, count] of [...kinds].sort()) say(`   ${count.toString().padStart(3)} x ${method}`)
  say(`   server->client requests: ${serverRequests.length}`)
  const sawAnswer = JSON.stringify(notifications).includes('SPIKE_OK')
  say(`   model answer present: ${sawAnswer}`)

  say(`\nVERDICT: app-server is ${sawAnswer ? 'DRIVABLE' : 'NOT yet driven to an answer'}`)
} catch (error) {
  say(`\nSPIKE FAILED: ${String(error && error.message)}`)
  say(stderr.join('').slice(0, 1200))
} finally {
  child.kill()
  // The child holds the cwd open on Windows; removing it immediately fails
  // with EBUSY and turns a successful spike into a crash at the last line.
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

process.exit(0)
