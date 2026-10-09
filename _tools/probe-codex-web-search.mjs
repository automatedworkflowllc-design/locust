// Does a Codex teammate search the web, in each of Locust's modes?
//
//   LOCUST_SPEND=1 node _tools/probe-codex-web-search.mjs [--codex <codex.cmd>] [--model <id>] [--config <k=v>]
//
// Colin, 2026-10-09: "dont we want web tools for all models?" Claude Code was
// given WebSearch and WebFetch in 0.711; this asks the same of Codex. Codex
// carries its own `web_search` tool, set by the `web_search` config value
// ("disabled" | "cached" | "indexed" | "live", app-server schema 0.162.0).
//
// One turn per mode over app-server, the transport Locust's mission loop
// uses, with the thread policy Locust gives that mode
// (codexAppServerPolicy): Read only, Edit, Auto and Approve-each. Each turn is
// asked a question only a live page answers, and the probe counts the
// webSearch items that arrive. Any approval request is declined.
//
// Spends four short turns on the cheapest Codex model at low effort -- hence
// LOCUST_SPEND=1. A scratch folder each, nothing in it.

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.env.LOCUST_SPEND !== '1') {
  console.log('This spends four short Codex turns. Run it with LOCUST_SPEND=1.')
  process.exit(2)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const bin = arg('--codex') ?? 'codex'
const model = arg('--model') ?? 'gpt-6-luna'
const extra = arg('--config')

const PROMPT =
  'Look on the web: what is the newest stable Electron release listed on releases.electronjs.org today? ' +
  'Answer with just the version number, or say NO_WEB if you have no way to search the web. Change nothing.'

// The thread policy Locust gives each mode (commands.ts, codexAppServerPolicy).
const MODES = [
  { name: 'Read only', sandbox: 'read-only', approvalPolicy: 'never' },
  { name: 'Edit', sandbox: 'workspace-write', approvalPolicy: 'never' },
  { name: 'Auto', sandbox: 'danger-full-access', approvalPolicy: 'never' },
  { name: 'Approve-each', sandbox: 'workspace-write', approvalPolicy: 'untrusted' }
]

async function oneTurn(mode) {
  const folder = await mkdtemp(join(tmpdir(), 'locust-web-search-'))
  const args = ['app-server', '-c', 'tools.update_plan.enabled=true', ...(extra ? ['-c', extra] : [])]
  const child = spawn(bin, args, { cwd: folder, shell: bin === 'codex' || bin.endsWith('.cmd'), windowsHide: true })
  let buffer = ''
  const waiting = new Map()
  const notes = []
  const asked = []
  let id = 0
  let finished
  const done = new Promise((resolve) => {
    finished = resolve
  })
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.length === 0) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message)
        waiting.delete(message.id)
      } else if (message.id !== undefined && message.method !== undefined) {
        asked.push(message.method)
        child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: 'decline' } })}\n`)
      } else if (message.method !== undefined) {
        notes.push(message)
        if (message.method === 'turn/completed') finished()
      }
    }
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const mine = ++id
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000)
      waiting.set(mine, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`))
        else resolve(message.result)
      })
      child.stdin.write(`${JSON.stringify({ id: mine, method, params })}\n`)
    })
  try {
    await request('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    const thread = await request('thread/start', { cwd: folder, sandbox: mode.sandbox, approvalPolicy: mode.approvalPolicy })
    await request('turn/start', {
      threadId: thread.thread.id,
      approvalPolicy: mode.approvalPolicy,
      input: [{ type: 'text', text: PROMPT }],
      model,
      effort: 'low'
    })
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 240_000))])
    const searches = notes.filter((n) => n.method === 'item/completed' && n.params?.item?.type === 'webSearch')
    const reply = notes
      .filter((n) => n.method === 'item/completed' && n.params?.item?.type === 'agentMessage')
      .map((n) => String(n.params.item.text ?? ''))
      .join(' | ')
    return {
      mode: mode.name,
      searches: searches.length,
      first: searches[0] ? JSON.stringify(searches[0].params.item).slice(0, 240) : '',
      reply: reply.slice(0, 160),
      asked
    }
  } catch (error) {
    return { mode: mode.name, error: error instanceof Error ? error.message : String(error), stderr: stderr.slice(0, 400) }
  } finally {
    child.kill()
  }
}

console.log(`Codex app-server, ${model}, low effort${extra ? `, -c ${extra}` : ''}`)
let failures = 0
for (const mode of MODES) {
  const result = await oneTurn(mode)
  if (result.error) {
    failures += 1
    console.log(`  [FAIL] ${result.mode}: ${result.error}${result.stderr ? ` -- ${result.stderr}` : ''}`)
    continue
  }
  const ok = result.searches > 0 && !/NO_WEB/.test(result.reply)
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${result.mode}: ${String(result.searches)} web searches; reply ${JSON.stringify(result.reply)}`)
  if (result.first) console.log(`         first: ${result.first}`)
  if (result.asked.length > 0) console.log(`         asked: ${result.asked.join(', ')}`)
}
console.log(failures === 0 ? 'CODEX WEB SEARCH PROBE PASSED' : `CODEX WEB SEARCH PROBE: ${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
