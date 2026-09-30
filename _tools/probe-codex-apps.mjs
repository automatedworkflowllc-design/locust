// Which apps and connectors does Codex's app-server offer Locust? (0.505, read-only)
//
//   node _tools/probe-codex-apps.mjs
//
// Colin, 2026-09-30: ChatGPT's Finances is a connector with a dashboard, and a
// tester is attached to it -- can Locust reach it? `codex exec` did not list
// its tools. This asks the app-server Locust already talks to for `app/list`
// ("EXPERIMENTAL - list available apps/connectors") and prints each app's
// name and flags -- names and states only. It calls no app, reads no data
// from any, and links nothing.

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cwd = await mkdtemp(join(tmpdir(), 'locust-probe-apps-'))
const child = spawn('codex', ['app-server'], { cwd, shell: true, stdio: ['pipe', 'pipe', 'ignore'] })
let nextId = 1
const waiting = new Map()
const send = (method, params) => new Promise((resolve) => {
  const id = nextId++
  waiting.set(id, resolve)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
})
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let at
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line.length === 0) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id !== undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message)
      waiting.delete(message.id)
    }
  }
})
const timeout = setTimeout(() => { console.log('no answer in 60 s'); child.kill(); process.exit(1) }, 60_000)

await send('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`)
const answer = await send('app/list', { limit: 200 })
clearTimeout(timeout)
if (answer.error !== undefined) {
  console.log('app/list refused:', JSON.stringify(answer.error).slice(0, 300))
} else {
  const apps = answer.result?.data ?? answer.result?.apps ?? []
  console.log(`apps listed: ${String(apps.length)}`)
  // The keys an app carries, once, so the shape is known without printing any content.
  if (apps[0] !== undefined) console.log('fields:', Object.keys(apps[0]).join(', '))
  for (const app of apps) {
    const flags = Object.entries(app).filter(([, value]) => typeof value === 'boolean').map(([key, value]) => `${key}=${String(value)}`).join(' ')
    console.log(`- ${String(app.name ?? app.id)} ${flags}`)
  }
}
child.kill()
process.exit(0)
