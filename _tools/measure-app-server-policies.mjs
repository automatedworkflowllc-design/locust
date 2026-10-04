// What does `codex app-server` accept for sandbox and approvalPolicy, and
// does it stream in the combinations the ordinary modes would need?
//
//   LOCUST_SPEND=1 node _tools/measure-app-server-policies.mjs
//
// Plan item 4 rests on one premise: that every Codex mode could ride the
// app-server transport, which streams, instead of `codex exec --json`, which
// sends an agent message once and whole. The premise is only worth building
// on if the transport takes the policies each mode needs -- read-only for
// Ask, workspace-write without asking for Accept edits -- and still sends
// `item/agentMessage/delta` when nothing is being approved.
//
// This asks the real binary. For each combination it starts a thread, runs a
// one-sentence turn, and reports whether the thread started, how many message
// deltas arrived, and how many of those were partial rather than the whole
// reply at once.
//
// SPENDS one small Codex turn per accepted combination, on gpt-5.6-luna at
// low effort. Never Astra.

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.env.LOCUST_SPEND !== '1') {
  console.log('refusing to run: this spends Codex turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const EXECUTABLE = process.env.LOCUST_CODEX ?? 'codex'
// A .cmd shim cannot be spawned directly on Node 24; the js entry can.
const PREFIX = process.env.LOCUST_CODEX_JS === undefined ? [] : [process.env.LOCUST_CODEX_JS]
const MODEL = 'gpt-5.6-luna'
const PROMPT = 'Write exactly three sentences about caching. No code, no lists.'

/** The combinations the four modes would need, named by the mode that needs them. */
const CASES = [
  { mode: 'ask', sandbox: 'read-only', approvalPolicy: 'never' },
  { mode: 'accept-edits', sandbox: 'workspace-write', approvalPolicy: 'never' },
  { mode: 'approve-each (today)', sandbox: 'workspace-write', approvalPolicy: 'untrusted' },
  { mode: 'auto', sandbox: 'danger-full-access', approvalPolicy: 'never' }
]

const workspace = await mkdtemp(join(tmpdir(), 'locust-appsrv-'))
await writeFile(join(workspace, 'NOTES.md'), 'A scratch project for a measurement.\n')

/** One app-server process, spoken to over the framed-line protocol. */
function open() {
  const child = spawn(EXECUTABLE, [...PREFIX, 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  const waiters = new Map()
  const events = []
  let onEvent = () => undefined
  child.stdout.on('data', (chunk) => {
    buffer += String(chunk)
    let cut = buffer.indexOf('\n')
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      cut = buffer.indexOf('\n')
      if (line.length === 0) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && waiters.has(message.id)) {
        const settle = waiters.get(message.id)
        waiters.delete(message.id)
        settle(message)
      } else if (typeof message.method === 'string') {
        events.push(message)
        onEvent(message)
      }
    }
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })

  let nextId = 0
  const send = (method, params) => {
    const id = (nextId += 1)
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return new Promise((resolve) => {
      waiters.set(id, resolve)
      child.stdin.write(line)
    })
  }
  return {
    send,
    notify: (method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
    events,
    watch: (listener) => {
      onEvent = listener
    },
    stderr: () => stderr,
    kill: () => child.kill()
  }
}

const withTimeout = (promise, ms, whenLate) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(whenLate), ms))])

for (const holds of CASES) {
  const server = open()
  const line = { mode: holds.mode, sandbox: holds.sandbox, approvalPolicy: holds.approvalPolicy }
  try {
    await withTimeout(server.send('initialize', { clientInfo: { name: 'locust-measure', version: '0.1.0' } }), 20_000, undefined)
    server.notify('initialized')
    const started = await withTimeout(
      server.send('thread/start', { cwd: workspace, sandbox: holds.sandbox, approvalPolicy: holds.approvalPolicy }),
      20_000,
      { error: { message: 'timed out' } }
    )
    if (started?.error !== undefined) {
      console.log(JSON.stringify({ ...line, threadStarted: false, refused: String(started.error.message ?? started.error).slice(0, 120) }))
      continue
    }
    const threadId = started?.result?.thread?.id
    if (typeof threadId !== 'string') {
      console.log(JSON.stringify({ ...line, threadStarted: false, refused: 'no thread id' }))
      continue
    }

    let deltas = 0
    let wholeReplies = 0
    let completedMessages = 0
    let approvalsAsked = 0
    let firstDelta
    // `turn/start` answers the moment the turn is accepted, not when it is
    // done -- the first version of this counted deltas before any had
    // arrived and read zero everywhere, including the mode that ships.
    let turnDone
    const finished = new Promise((resolve) => {
      turnDone = resolve
    })
    server.watch((message) => {
      const method = String(message.method ?? '')
      if (method === 'item/agentMessage/delta') {
        deltas += 1
        const text = String(message.params?.delta ?? '')
        if (firstDelta === undefined) firstDelta = text.slice(0, 40)
        if (text.length > 120) wholeReplies += 1
      }
      if (method === 'item/completed' && String(message.params?.item?.type ?? '') === 'agentMessage') completedMessages += 1
      if (method.toLowerCase().includes('approval')) approvalsAsked += 1
      if (method === 'turn/completed' || method === 'turn/failed') turnDone('done')
    })

    const turn = await withTimeout(
      server.send('turn/start', {
        threadId,
        approvalPolicy: holds.approvalPolicy,
        input: [{ type: 'text', text: PROMPT }],
        model: MODEL,
        effort: 'low'
      }),
      180_000,
      { error: { message: 'turn timed out' } }
    )
    const ended = await withTimeout(finished, 180_000, 'never ended')
    console.log(JSON.stringify({
      ...line,
      threadStarted: true,
      turnError: turn?.error === undefined ? undefined : String(turn.error.message ?? turn.error).slice(0, 120),
      ended,
      messageDeltas: deltas,
      deltasOver120Chars: wholeReplies,
      completedAgentMessages: completedMessages,
      approvalRequests: approvalsAsked,
      firstDelta
    }))
  } catch (error) {
    console.log(JSON.stringify({ ...line, failed: String(error).slice(0, 160) }))
  } finally {
    server.kill()
  }
}
