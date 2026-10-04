// Colin: "Record a few real Codex app-server sessions as fixtures ... an
// approval, a file change, a steer, and a limit if one can be met cheaply.
// Use gpt-6-luna at low effort." Explicit opt-in; three bounded scratch turns.
// pnpm --filter @teammate/runtime-adapters build
// LOCUST_SPEND=1 node _tools/record-codex-app-server-fixtures.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathExecutableLocator, createCodexAppServerCommand, startCodexAppServerRun, createAppServerEventNormalizer, asProcessNormalizer, killSpawnedTree, spawnShape, redactSecrets } from '../packages/runtime-adapters/dist/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'packages/runtime-adapters/test/fixtures/codex')
const MODEL = 'gpt-6-luna'
const SCENARIOS = [
  { name: 'approval-declined', sandbox: 'read-only', policy: 'on-request', prompt: 'This is a protocol fixture. Use exec_command to run Write-Output FIXTURE_APPROVAL with sandbox_permissions=require_escalated and justification="Fixture approval: print a marker." Do not edit files or access the network. If permission is declined, do not retry; reply APPROVAL_DECLINED.' },
  { name: 'file-change', sandbox: 'workspace-write', policy: 'never', prompt: 'Use apply_patch to replace the single line BEFORE in notes.txt with AFTER. Do not use any other tools, read any other files, or access the network. Then reply FILE_CHANGED.' },
  { name: 'steer', sandbox: 'read-only', policy: 'never', prompt: 'Run exactly this one command with exec_command: Start-Sleep -Seconds 2; Write-Output BEFORE_STEER. Do not edit files, read other files, use any other tools, or access the network. After it finishes, answer BEFORE_STEER.' }
]
export const STEER_TEXT = 'After the command finishes, answer only STEER_ACCEPTED instead of BEFORE_STEER.'
// These are the notification families the adapter can use. Do not retain
// legacy codex/event mirrors, raw response items or reasoning text deltas.
const METHODS = new Set(['thread/started', 'turn/started', 'turn/completed', 'turn/failed', 'item/started', 'item/completed', 'item/agentMessage/delta', 'turn/plan/updated', 'turn/diff/updated', 'thread/tokenUsage/updated', 'thread/compacted', 'error', 'model/rerouted'])

/** Scrub before persistence. IDs stay correlated; raw reasoning/account
 * readings and machine metadata never reach a fixture file. */
export function fixtureScrubber(cwd, home = homedir()) {
  const ids = new Map()
  const identity = (value) => {
    if (!ids.has(value)) ids.set(value, `fixture_id_${ids.size + 1}`)
    return ids.get(value)
  }
  const scrub = (value, key = '') => {
    if (typeof value === 'string') {
      if (/^(id|threadId|turnId|itemId|expectedTurnId|callId)$/.test(key)) return identity(value)
      if (/^(userAgent|hostname|deviceId|providerSessionId|sessionId|processId)$/.test(key)) return '[machine metadata removed]'
      if (key === 'path' && value.includes('sessions')) return '/fixture/rollout.jsonl'
      return redactSecrets(value.split(cwd).join('C:\\fixture\\codex').split(cwd.replaceAll('\\', '/')).join('C:/fixture/codex')
        .split(home).join('C:\\fixture\\home').split(home.replaceAll('\\', '/')).join('C:/fixture/home')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]'))
    }
    if (Array.isArray(value)) return value.map((entry) => scrub(entry, key))
    if (value !== null && typeof value === 'object') {
      const out = {}
      for (const [name, entry] of Object.entries(value)) {
        if (/^(account|email|credits|planType|plan_type|accessToken|refreshToken|idToken|authorization|encryptedContent|encrypted_content|gitInfo|baseInstructions|developerInstructions)$/.test(name)) continue
        // Only the concise reasoning summary is a product surface.
        if (value.type === 'reasoning' && name === 'content') { out[name] = []; continue }
        if (/^(createdAt|updatedAt|recencyAt|timestamp|emittedAtMs|startedAt|startedAtMs|completedAt|completedAtMs)$/.test(name)) { out[name] = entry === null ? null : 0; continue }
        out[name] = scrub(entry, name)
      }
      return out
    }
    return value
  }
  return (message) => {
    if (message.method !== undefined && message.id === undefined && message.method !== 'initialized' && !METHODS.has(message.method)) return undefined
    return scrub(message)
  }
}

async function record(scenario, launch, version, parent) {
  const cwd = await mkdtemp(join(parent, `codex-${scenario.name}-`))
  await writeFile(join(cwd, 'notes.txt'), 'BEFORE\n')
  const init = spawnSync('git', ['init', '-q'], { cwd, windowsHide: true })
  if (init.status !== 0) throw new Error('Could not initialize the disposable fixture repository.')
  const scrub = fixtureScrubber(cwd)
  const rows = []
  let approvals = 0
  let steerAccepted
  let steerPending
  let exited
  const closed = new Promise((resolve) => { exited = resolve })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  let run
  let killed = false
  let stderr = ''
  let processError
  const command = createCodexAppServerCommand(launch, { workspacePath: cwd, sandbox: scenario.sandbox, cliVersion: version })
  const save = (dir, message) => { const cleaned = scrub(message); if (cleaned !== undefined) rows.push({ dir, message: cleaned }) }
  try {
    run = startCodexAppServerRun({
      command, prompt: scenario.prompt, sandbox: scenario.sandbox, approvalPolicy: scenario.policy,
      model: MODEL, effort: 'low', signal: controller.signal,
      onRequest: async () => { approvals += 1; return { decision: 'decline' } },
      spawn: (file, args, env) => {
        const shape = spawnShape(file, args)
        const child = spawn(file, [...shape.args], { cwd, env: { ...process.env, ...env }, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], ...shape.windowsVerbatimArguments && { windowsVerbatimArguments: true } })
        child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192) })
        child.once('error', (error) => { processError = error; exited() })
        child.once('close', () => exited())
        return {
          write: (line) => { for (const part of line.trim().split('\n')) save('out', JSON.parse(part)); child.stdin.write(line) },
          kill: () => { if (!killed) { killed = true; if (child.pid !== undefined) killSpawnedTree(child.pid, process.platform); child.kill() } },
          stderrTail: () => stderr,
          onExit: (listener) => { child.once('close', listener); child.once('error', listener) },
          onData: (listener) => {
            let buffer = ''
            child.stdout.setEncoding('utf8')
            child.stdout.on('data', (chunk) => {
              buffer += chunk
              let cut
              while ((cut = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, cut); buffer = buffer.slice(cut + 1)
                if (!line.trim()) continue
                const message = JSON.parse(line)
                save('in', message)
                listener(`${line}\n`)
                if (scenario.name === 'steer' && steerPending === undefined && message.method === 'item/started' && message.params?.item?.type === 'commandExecution') {
                  steerPending = run.steer(STEER_TEXT).then((accepted) => { steerAccepted = accepted })
                }
              }
            })
          }
        }
      }
    })
    const normalizer = asProcessNormalizer(createAppServerEventNormalizer({ runId: 'recording' }))
    let finalText = ''
    let failure
    for await (const row of run.records) {
      for (const event of normalizer.accept(row)) {
        if (event.type === 'message.delta') finalText = event.payload.operation === 'replace' ? event.payload.text : finalText + event.payload.text
        if (event.type === 'run.failed') failure = event.payload.message
      }
    }
    const completion = await run.completion
    await steerPending
    await closed
    if (processError !== undefined) throw processError
    rows.push({ dir: 'exit', completion: { exitCode: completion.exitCode, cancelled: completion.cancelled } })
    await mkdir(DEST, { recursive: true })
    await writeFile(join(DEST, `${failure === undefined ? scenario.name : `failed-${scenario.name}`}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const file = await readFile(join(cwd, 'notes.txt'), 'utf8')
    const summary = { name: scenario.name, messages: rows.length, approvals, steerAccepted, fileChanged: file === 'AFTER\n', terminal: completion.exitCode, cancelled: completion.cancelled, ...(failure === undefined ? {} : { failure: scrub({ text: failure }).text }), finalText: scrub({ text: finalText }).text }
    console.log(JSON.stringify(summary))
    return summary
  } finally { clearTimeout(timer); controller.abort() }
}

async function main() {
  if (process.env.LOCUST_SPEND !== '1') throw new Error('This records three real gpt-6-luna / low turns. Set LOCUST_SPEND=1 only with permission.')
  const launch = await createPathExecutableLocator().find('codex')
  if (launch === undefined) throw new Error('Codex is not installed.')
  const shape = spawnShape(launch.executablePath, [...launch.prefixArgs, '--version'])
  const result = spawnSync(launch.executablePath, [...shape.args], { encoding: 'utf8', windowsHide: true, ...shape.windowsVerbatimArguments && { windowsVerbatimArguments: true } })
  if (result.status !== 0) throw new Error('Could not read the Codex version.')
  const version = result.stdout.trim().replace(/^codex-cli\s+/, '')
  const parent = join(dirname(ROOT), '.tmp', 'codex-fixture-recording')
  await mkdir(parent, { recursive: true })
  const summaries = []
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : SCENARIOS.map((scenario) => scenario.name)
  for (const name of only) {
    const scenario = SCENARIOS.find((scenario) => scenario.name === name)
    if (scenario === undefined) throw new Error(`Unknown fixture scenario: ${name}`)
    summaries.push(await record(scenario, launch, version, parent))
  }
  let previous = []
  try { previous = JSON.parse(await readFile(join(DEST, 'recording.json'), 'utf8')).scenarios } catch { /* First recording. */ }
  const combined = [...previous.filter((summary) => !only.includes(summary.name)), ...summaries]
  await writeFile(join(DEST, 'recording.json'), JSON.stringify({ version, model: MODEL, effort: 'low', recordedOn: '2026-10-03', scenarios: combined }, null, 2) + '\n')
  if (summaries.some((summary) => summary.cancelled || summary.terminal !== 0 || summary.failure !== undefined || summary.name === 'approval-declined' && summary.approvals === 0 || summary.name === 'file-change' && !summary.fileChanged || summary.name === 'steer' && summary.steerAccepted !== true)) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
