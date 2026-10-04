// Does a Codex turn keep its plan with the tool Locust draws, or type it out?
//
//   LOCUST_SPEND=1 node _tools/probe-codex-plan-tool.mjs [--without] [--codex <codex.cmd>] [--model <id>]
//
// Colin, 2026-09-23, on a Codex reply that opened with a typed "TODO" list of
// "In progress: ..." and "Pending: ..." lines: "planui looks like its failing
// in here in a codex chart". The session's own log showed why: Codex 0.153
// only offers its update_plan tool when the config says
// tools.update_plan.enabled, and it did not, so the model -- told by Locust to
// "KEEP A TODO LIST ... using your own todo tool" -- had no tool and typed one.
// No turn/plan/updated arrived, so the plan panel had nothing to draw.
//
// This runs ONE turn over app-server, the transport Locust's mission loop
// uses, with the same todo sentence Locust sends, and reports whether
// turn/plan/updated arrived and whether the reply typed a list instead.
// --without leaves the tool off, as Locust launched Codex until 0.304.
//
// Spends one short turn on the cheapest Codex model (GPT-5.6-Luna, low
// effort) -- hence LOCUST_SPEND=1. Read-only sandbox, in a scratch folder.

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.env.LOCUST_SPEND !== '1') {
  console.log('This spends one short Codex turn. Run it with LOCUST_SPEND=1.')
  process.exit(2)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const WITHOUT = process.argv.includes('--without')
const bin = arg('--codex') ?? 'codex'
const model = arg('--model') ?? 'gpt-5.6-luna'

const folder = await mkdtemp(join(tmpdir(), 'locust-plan-tool-'))
await writeFile(join(folder, 'notes.txt'), 'alpha\nbeta\ngamma\n')
await writeFile(join(folder, 'todo.md'), '# Things\n- one\n- two\n')
await writeFile(join(folder, 'data.csv'), 'a,b\n1,2\n3,4\n')

// The sentence Locust's briefing sends a Codex teammate (todoSection).
const TODO_SENTENCE = [
  'KEEP A TODO LIST for this work, using your own todo tool, and keep it current.',
  'Add the steps when you know them, mark one in progress while you are on it, and mark it done when it is actually done -- not when you start writing the next one.',
  'The person is watching this list rather than reading every line of output, so a stale list is worse than no list.'
].join('\n')
const PROMPT = `${TODO_SENTENCE}\n\nIn this folder: list the files, count the lines in each, then say which file has the most lines. Change nothing.`

const args = WITHOUT ? ['app-server'] : ['app-server', '-c', 'tools.update_plan.enabled=true']
const child = spawn(bin, args, { cwd: folder, shell: bin === 'codex' || bin.endsWith('.cmd'), windowsHide: true })
let buffer = ''
const waiting = new Map()
const notes = []
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
      // An approval request: this probe approves nothing.
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

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await request('initialize', { clientInfo: { name: 'locust-probe', version: '0.1.0' } })
  child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
  const thread = await request('thread/start', { cwd: folder, sandbox: 'read-only', approvalPolicy: 'never' })
  await request('turn/start', { threadId: thread.thread.id, approvalPolicy: 'never', input: [{ type: 'text', text: PROMPT }], model, effort: 'low' })
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 240_000))])
  const plans = notes.filter((n) => n.method === 'turn/plan/updated')
  const reply = notes
    .filter((n) => n.method === 'item/completed' && n.params?.item?.type === 'agentMessage')
    .map((n) => String(n.params.item.text ?? ''))
    .join('\n---\n')
  const typed = /^\s*(TODO|Plan|Todo)\b|^\s*[-*]\s*(In progress|Pending|Done|Completed)\s*:/im.test(reply)
  console.log(`Codex app-server ${WITHOUT ? 'WITHOUT' : 'WITH'} tools.update_plan.enabled, ${model}, low effort`)
  console.log(`  turn/plan/updated: ${String(plans.length)}${plans.length ? ` -- last: ${JSON.stringify(plans.at(-1).params.plan).slice(0, 300)}` : ''}`)
  console.log(`  reply: ${JSON.stringify(reply.slice(0, 400))}`)
  if (WITHOUT) {
    check('without the tool, no plan reaches Locust', plans.length === 0, `${String(plans.length)} plan updates`)
  } else {
    check('the plan arrives as turn/plan/updated, which Locust draws', plans.length > 0, `${String(plans.length)} plan updates`)
    check('and is not typed into the reply', !typed, typed ? 'the reply types a list' : undefined)
  }
  if (/error|unknown|invalid/i.test(stderr)) console.log(`  stderr: ${stderr.slice(0, 400)}`)
} catch (error) {
  failures += 1
  console.log(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
  if (stderr) console.log(`  stderr: ${stderr.slice(0, 600)}`)
} finally {
  child.kill()
}
console.log(failures === 0 ? 'CODEX PLAN TOOL PROBE PASSED' : `CODEX PLAN TOOL PROBE: ${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
