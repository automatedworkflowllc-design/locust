// Protocol measurement only. No turn/start, account calls, or provider spend.
// Keep stdout draining: this is deliberately NOT a back-pressure experiment.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { join } from 'node:path'

function methods(text) {
  assert.match(text, /export type (ClientRequest|ServerRequest) =/)
  const found = [...text.matchAll(/"method":\s*"([^"]+)"/g)].map((match) => match[1])
  assert.ok(found.length > 0, 'INCONCLUSIVE: no methods parsed')
  assert.equal(new Set(found).size, found.length, 'Duplicate methods: inspect schema shape')
  return found
}
function recognizedError(response) {
  assert.ok(response && response.error && Number.isInteger(response.error.code), 'INCONCLUSIVE: no RPC error evidence')
  assert.equal(typeof response.error.message, 'string')
  return !/unknown variant|method not found|unknown method/i.test(response.error.message)
}
const pauseNames = (names) => names.filter((name) => /(?:^|\/)(pause|suspend|hold|unpause|quiesce|resume)$/.test(name))

// The measurement must fail on zero data and must detect a pause if one is
// inserted. Otherwise an empty parser could confidently close the design item.
assert.throws(() => methods(''), /AssertionError/)
assert.throws(() => methods('export type ClientRequest = never'), /no methods parsed/)
assert.throws(() => recognizedError(undefined), /no RPC error evidence/)
assert.throws(() => recognizedError({ result: {} }), /no RPC error evidence/)
assert.deepEqual(pauseNames(methods('export type ClientRequest = { "method": "turn/pause" }')), ['turn/pause'])
assert.equal(recognizedError({ error: { code: -32600, message: 'unknown variant turn/pause' } }), false)
assert.equal(recognizedError({ error: { code: -32600, message: 'missing field threadId' } }), true)
console.log('CONTROLS: empty/truncated data rejected; synthetic pause and RPC distinctions detected')
if (process.argv.includes('--self-test')) process.exit(0)

const [schemaDirectory, executable] = process.argv.slice(2)
assert.ok(schemaDirectory && executable, 'Usage: node _tools/probe-app-server-hold.mjs SCHEMA_DIRECTORY CODEX_EXE')
const clientMethods = methods(await readFile(join(schemaDirectory, 'ClientRequest.ts'), 'utf8'))
const serverMethods = methods(await readFile(join(schemaDirectory, 'ServerRequest.ts'), 'utf8'))
assert.ok(clientMethods.length >= 50, 'INCONCLUSIVE: unexpectedly short client inventory')
for (const required of ['initialize', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt', 'turn/steer']) {
  assert.ok(clientMethods.includes(required), `INCONCLUSIVE: missing known control ${required}`)
}
assert.ok(serverMethods.includes('item/commandExecution/requestApproval'), 'INCONCLUSIVE: approvals not parsed')
console.log(JSON.stringify({ clientCount: clientMethods.length, serverCount: serverMethods.length,
  turnMethods: clientMethods.filter((name) => name.startsWith('turn/')),
  candidateNames: pauseNames(clientMethods),
  elicitationMethods: clientMethods.filter((name) => name.includes('elicitation')) }))

const child = spawn(executable, ['app-server', '--stdio'], { cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = new Map()
let sequence = 0
let parsedResponses = 0
let buffer = ''
function fail(error) { for (const entry of pending.values()) entry.reject(error); pending.clear() }
child.on('error', fail)
child.on('exit', () => fail(new Error('INCONCLUSIVE: server exited before replying')))
child.stderr.on('data', () => {}) // Drain without exposing profile/provider diagnostics.
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  if (buffer.length > 4 * 1024 * 1024) return fail(new Error('INCONCLUSIVE: framing limit exceeded'))
  while (buffer.includes('\n')) {
    const boundary = buffer.indexOf('\n')
    const line = buffer.slice(0, boundary)
    buffer = buffer.slice(boundary + 1)
    if (!line.trim()) continue
    let message
    try { message = JSON.parse(line) } catch { fail(new Error('INCONCLUSIVE: non-JSON stdout')); return }
    const entry = pending.get(message.id)
    if (entry && !message.method) {
      parsedResponses++
      pending.delete(message.id)
      entry.resolve(message)
    }
  }
})
async function request(method, params) {
  const id = ++sequence
  let timer
  try {
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      timer = setTimeout(() => { pending.delete(id); reject(new Error(`INCONCLUSIVE: no matching response to ${method}`)) }, 10_000)
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  } finally { clearTimeout(timer) }
}
try {
  const initialized = await request('initialize', { clientInfo: { name: 'locust-pause-measurement', version: '1' }, capabilities: { experimentalApi: true } })
  assert.equal(initialized.error, undefined)
  assert.equal(typeof initialized.result?.userAgent, 'string', 'INCONCLUSIVE: initialization returned no server identity')
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  // A known method with invalid parameters proves the dispatcher is awake;
  // unknown-method errors alone could otherwise be a broken connection/setup.
  const known = await request('turn/interrupt', {})
  assert.equal(recognizedError(known), true)
  assert.match(known.error.message, /missing field/i)
  console.log(JSON.stringify({ method: 'turn/interrupt', recognized: true, code: known.error.code, message: known.error.message.slice(0, 120) }))
  for (const method of ['turn/pause', 'turn/resume', 'thread/pause', 'thread/suspend']) {
    const response = await request(method, {})
    assert.equal(recognizedError(response), false, `${method} is recognized: investigate rather than conclude absence`)
    console.log(JSON.stringify({ method, recognized: false, code: response.error.code, message: response.error.message.slice(0, 100) }))
  }
  assert.equal(parsedResponses, 6, 'INCONCLUSIVE: expected all six matched responses')
  console.log('MEASURED: six matched responses; tested pause/resume names rejected. This does not measure approval quiescence or an active turn.')
} finally {
  // Only the PID created above, never another app-server or the desktop's tree.
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
}
