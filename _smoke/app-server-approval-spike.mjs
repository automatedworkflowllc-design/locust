// Spike 2: does the approval round trip actually fire?
//
// The first spike proved app-server runs a turn, but it ran read-only, so
// nothing needed approving and "0 server->client requests" was the correct
// result rather than evidence the approval path works. This is the experiment
// that settles it: a turn under `untrusted` approvals that must run a command,
// and a DENY answered back.
//
//   node _smoke/app-server-approval-spike.mjs
//
// Runs in a throwaway git repo and removes it. Denying is deliberate -- the
// point is to prove the channel, not to let a spike execute anything.

import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CODEX = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e\\codex.exe'
const PROMPT =
  'Run the shell command `echo hello` in this directory using your shell tool. Do not ask me anything first.'

const root = await mkdtemp(join(tmpdir(), 'locust-approval-'))
execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
await writeFile(join(root, 'README.md'), 'scratch\n', 'utf8')

const child = spawn(CODEX, ['app-server'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
const stderr = []
child.stderr.on('data', (chunk) => stderr.push(String(chunk)))

let nextId = 0
const pending = new Map()
const approvals = []
let buffer = ''

const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)

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
      approvals.push(message)
      // Answer immediately, and DENY. A spike must not be able to run a
      // command on this machine to prove that it could have.
      write({ jsonrpc: '2.0', id: message.id, result: { decision: 'reject' } })
    }
  }
})

function send(method, params) {
  const id = ++nextId
  write({ jsonrpc: '2.0', id, method, params })
  return Promise.race([
    new Promise((resolve) => pending.set(id, resolve)),
    new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 60_000))
  ])
}

const say = (line) => console.error(line)

try {
  await send('initialize', { clientInfo: { name: 'locust-spike', version: '0.0.1' } })
  write({ jsonrpc: '2.0', method: 'initialized', params: {} })

  const thread = await send('thread/start', {
    cwd: root,
    approvalPolicy: 'untrusted',
    sandbox: 'read-only'
  })
  const threadId = thread.result?.thread?.id ?? thread.result?.threadId
  say(`thread: ${threadId ?? 'NONE'}`)
  if (threadId === undefined) throw new Error(JSON.stringify(thread).slice(0, 400))

  say('turn/start with approvalPolicy untrusted, asking for a shell command')
  const turn = await send('turn/start', {
    threadId,
    input: [{ type: 'text', text: PROMPT }],
    approvalPolicy: 'untrusted'
  })
  if (turn.error) say(`turn error: ${JSON.stringify(turn.error).slice(0, 300)}`)

  await new Promise((resolve) => setTimeout(resolve, 40_000))

  say(`\nserver -> client approval requests: ${approvals.length}`)
  for (const request of approvals.slice(0, 3)) {
    say(`  ${request.method}`)
    say(`    ${JSON.stringify(request.params).slice(0, 300)}`)
  }
  say(
    `\nVERDICT: the approval channel is ${approvals.length > 0 ? 'PROVEN' : 'NOT proven by this run'}`
  )
} catch (error) {
  say(`SPIKE FAILED: ${String(error && error.message)}`)
  say(stderr.join('').slice(0, 800))
} finally {
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

process.exit(0)
