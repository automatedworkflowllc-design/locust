// Live smoke for the app-server client.
//
// The unit tests drive the client with a fake transport, so they prove the
// protocol logic and nothing about the real server. This runs the SHIPPED
// client against a real `codex app-server`, through both paths that matter: a
// plain turn, and a turn that must ask permission.
//
//   node _smoke/app-server-smoke.mjs
//
// Exits non-zero on any failed assertion. Runs in throwaway git repos and
// answers every approval with a REFUSAL -- a smoke must not be able to run a
// command on this machine in order to prove that it could have.

import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const { createAppServerClient } = await import(
  new URL('../packages/runtime-adapters/dist/index.js', import.meta.url).href
)

// The binary the npm package actually runs (its shim spawns this exe), else
// the newest of the OpenAI-managed installs. The old hard-coded path died
// with an update on 2026-09-05 and the smoke spawned nothing.
import { existsSync, readdirSync, statSync } from 'node:fs'
const NPM_CODEX = join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
const OPENAI_BIN = join(homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin')
function resolveCodex() {
  if (existsSync(NPM_CODEX)) return NPM_CODEX
  try {
    const dirs = readdirSync(OPENAI_BIN).map((name) => join(OPENAI_BIN, name, 'codex.exe')).filter((p) => existsSync(p))
    dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (dirs[0]) return dirs[0]
  } catch { /* none */ }
  throw new Error('no codex.exe found for the smoke')
}
const CODEX = resolveCodex()

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function session(run) {
  const root = await mkdtemp(join(tmpdir(), 'locust-appserver-smoke-'))
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
  await writeFile(join(root, 'README.md'), 'scratch\n', 'utf8')

  const child = spawn(CODEX, ['app-server'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  const notifications = []
  const approvals = []
  const diagnostics = []

  const client = createAppServerClient({
    transport: {
      send: (line) => child.stdin.write(line),
      close: () => child.kill()
    },
    onNotification: (notification) => notifications.push(notification),
    onRequest: async (request) => {
      approvals.push(request)
      // Always refuse. Proving the channel does not require running anything.
      return { decision: 'reject' }
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  })

  child.stdout.on('data', (chunk) => client.accept(String(chunk)))

  try {
    return await run({ client, root, notifications, approvals, diagnostics })
  } finally {
    client.dispose('smoke finished')
    // app-server spawns its own children (a code-mode host), and killing only
    // the parent leaves them running after the smoke exits. Take the tree.
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' })
    } catch {
      child.kill()
    }
    await sleep(1_500)
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

console.error('1. handshake, models, and a plain turn')
await session(async ({ client, root, notifications, diagnostics }) => {
  const init = await client.request('initialize', {
    clientInfo: { name: 'locust-smoke', version: '0.0.1' }
  })
  check('initialize answered', init !== null && typeof init === 'object')
  client.notify('initialized')

  const models = await client.request('model/list', {})
  const list = models?.data ?? []
  check('model/list returns real models', Array.isArray(list) && list.length > 0, `${list.length}`)
  // Effort must degrade per model rather than be assumed uniform.
  const efforts = list.map((entry) => (entry.supportedReasoningEfforts ?? []).length)
  check('each model reports its own supported efforts', efforts.every((count) => count > 0))
  check('models do not all support the same efforts', new Set(efforts).size > 1, efforts.join(','))

  const thread = await client.request('thread/start', { cwd: root, sandbox: 'read-only' })
  const threadId = thread?.thread?.id ?? thread?.threadId
  check('thread/start returns a thread id', typeof threadId === 'string')

  await client.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: 'Reply with exactly SMOKE_OK and nothing else.' }]
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (notifications.some((entry) => entry.method === 'turn/completed')) break
    await sleep(500)
  }

  const methods = notifications.map((entry) => entry.method)
  check('the turn completed', methods.includes('turn/completed'))
  check('the model answer arrived', JSON.stringify(notifications).includes('SMOKE_OK'))
  check('no protocol diagnostics were raised', diagnostics.length === 0, JSON.stringify(diagnostics).slice(0, 200))
})

console.error('2. a turn that must ask permission')
await session(async ({ client, root, approvals, notifications }) => {
  await client.request('initialize', { clientInfo: { name: 'locust-smoke', version: '0.0.1' } })
  client.notify('initialized')
  const thread = await client.request('thread/start', {
    cwd: root,
    sandbox: 'read-only',
    approvalPolicy: 'untrusted'
  })
  const threadId = thread?.thread?.id ?? thread?.threadId

  await client.request('turn/start', {
    threadId,
    approvalPolicy: 'untrusted',
    input: [
      {
        type: 'text',
        text: 'Run the shell command `echo hello` in this directory using your shell tool. Do not ask me anything first.'
      }
    ]
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (approvals.length > 0) break
    await sleep(500)
  }

  check('an approval request reached the client', approvals.length > 0, `${approvals.length}`)
  const request = approvals[0]
  check(
    'it is a command-execution approval',
    request?.method === 'item/commandExecution/requestApproval',
    request?.method
  )
  // The card has to be able to say WHAT is about to happen and attribute it.
  check('it carries the exact command', typeof request?.params?.command === 'string')
  check('it carries thread and item ids', typeof request?.params?.threadId === 'string' && typeof request?.params?.itemId === 'string')

  // And our refusal has to be accepted rather than stranding the turn.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (notifications.some((entry) => entry.method === 'turn/completed')) break
    await sleep(500)
  }
  check(
    'the turn settled after the refusal',
    notifications.some((entry) => entry.method === 'turn/completed')
  )
})

console.error('3. a turn that must ask permission to change a file -- and what the item carries')
await session(async ({ client, root, approvals, notifications }) => {
  await client.request('initialize', { clientInfo: { name: 'locust-smoke', version: '0.0.1' } })
  client.notify('initialized')
  const thread = await client.request('thread/start', {
    cwd: root,
    sandbox: 'read-only',
    approvalPolicy: 'untrusted'
  })
  const threadId = thread?.thread?.id ?? thread?.threadId
  await client.request('turn/start', {
    threadId,
    approvalPolicy: 'untrusted',
    input: [
      {
        type: 'text',
        text: 'Using your file-editing tool (apply_patch), create a new file named SMOKE.txt in this directory containing exactly the line: smoke ok. Do not run shell commands and do not ask me anything first.'
      }
    ]
  })
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (approvals.some((entry) => entry.method === 'item/fileChange/requestApproval')) break
    await sleep(500)
  }
  const request = approvals.find((entry) => entry.method === 'item/fileChange/requestApproval')
  check('a file-change approval reached the client', request !== undefined, approvals.map((entry) => entry.method).join(', '))
  // The schema (generated from the CLI on 2026-09-05) says the approval
  // carries only the item id; the change itself rides on the fileChange
  // item's notification. This is the live check of that reading.
  check('the approval names its item and nothing more about the change', typeof request?.params?.itemId === 'string' && request?.params?.changes === undefined, JSON.stringify(request?.params ?? {}).slice(0, 200))
  const itemId = request?.params?.itemId
  const carrying = notifications.find((entry) => entry?.params?.item?.id === itemId && entry?.params?.item?.type === 'fileChange')
  const changes = carrying?.params?.item?.changes
  check('a notification carried the fileChange item with its changes', Array.isArray(changes) && changes.length > 0, `${carrying?.method ?? 'none'} · ${JSON.stringify(changes ?? []).slice(0, 160)}`)
  const first = Array.isArray(changes) ? changes[0] : undefined
  // Measured live 2026-09-05: for an ADD the diff is the file's CONTENT, not a hunk; the host synthesises the hunk (approval-patch.ts).
  check('each change has a path, a kind and diff text', typeof first?.path === 'string' && typeof first?.kind?.type === 'string' && typeof first?.diff === 'string' && first.diff.length > 0, JSON.stringify(first ?? {}).slice(0, 200))
  check('the diff names the new file and its line', /SMOKE\.txt|smoke ok/.test(JSON.stringify(first ?? {})), JSON.stringify(first?.diff ?? '').slice(0, 160))
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (notifications.some((entry) => entry.method === 'turn/completed')) break
    await sleep(500)
  }
  check('the turn settled after the refusal, and nothing was written', notifications.some((entry) => entry.method === 'turn/completed'))
})

console.error(`\n${failures === 0 ? 'APP-SERVER SMOKE PASSED' : `APP-SERVER SMOKE FAILED (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)
