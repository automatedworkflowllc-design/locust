// Do Cursor Agent, Copilot CLI and Antigravity search the web, as Locust runs them?
//
//   LOCUST_SPEND=1 node _tools/probe-web-search-each-runtime.mjs [--only cursor,copilot,antigravity] [--modes read-only,workspace-write,full-access]
//
// Colin, 2026-10-09: "dont we want web tools for all models?" Claude Code was
// given its web tools in 0.711 and Codex was measured searching in every mode
// (probe-codex-web-search.mjs). This asks the other three the same question.
//
// The REAL pieces: each runtime's own command builder makes the argv for the
// mode, the real process runner spawns it and delivers the prompt the way the
// spec says, and the runtime's own normalizer reads what comes back -- so the
// tool rows printed are the rows Locust would draw. Nothing is added to the
// argv. One turn per runtime and mode, on its cheapest model, in an empty
// scratch folder -- hence LOCUST_SPEND=1.

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAgyPrintCommand,
  createAgyEventNormalizer,
  createCopilotEventNormalizer,
  createCopilotPromptCommand,
  createCursorEventNormalizer,
  createCursorPrintCommand,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator
} from '../packages/runtime-adapters/dist/index.js'

if (process.env.LOCUST_SPEND !== '1') {
  console.log('This spends one short turn per runtime and mode. Run it with LOCUST_SPEND=1.')
  process.exit(2)
}
const argumentAfter = (flag) => {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}
const ONLY = argumentAfter('--only')?.split(',')
const MODES = argumentAfter('--modes')?.split(',') ?? ['read-only', 'workspace-write', 'full-access']
// For Cursor only: rules to put in the scratch folder's `.cursor/cli.json`
// first, the file Locust's run already writes its connector rules into
// (cursor-connector-allow.ts). Comma-separated, e.g. --cursor-allow "WebFetch(*)".
const CURSOR_ALLOW = argumentAfter('--cursor-allow')?.split(',')
// And any other top-level keys for that file, as JSON: --cursor-extra '{"autoAcceptWebSearch":true}'.
const CURSOR_EXTRA = argumentAfter('--cursor-extra') === undefined ? {} : JSON.parse(argumentAfter('--cursor-extra'))

/*
 * `cursor-agent --model X` saves X as the person's Cursor default
 * (cursor-default-model.ts). Locust puts it back after every run; this probe
 * must too -- its first run on 2026-10-09 did not, and left Colin's Cursor on
 * Composer 2.5 until it was put back by hand. Only the model fields are read
 * and written; the rest of the file (which holds the sign-in) is carried over
 * untouched and never printed.
 */
const CURSOR_CONFIG = join(homedir(), '.cursor', 'cli-config.json')
const MODEL_FIELDS = ['model', 'selectedModel', 'modelSelectionHistory', 'modelParameters']
const keepCursorDefault = () => {
  const text = readFileSync(CURSOR_CONFIG, 'utf8')
  const config = JSON.parse(text)
  return Object.fromEntries(MODEL_FIELDS.filter((field) => field in config).map((field) => [field, config[field]]))
}
const putCursorDefaultBack = (kept) => {
  const text = readFileSync(CURSOR_CONFIG, 'utf8')
  const config = JSON.parse(text)
  if (MODEL_FIELDS.every((field) => JSON.stringify(config[field]) === JSON.stringify(kept[field]))) return 'unchanged'
  for (const field of MODEL_FIELDS) {
    if (field in kept) config[field] = kept[field]
    else delete config[field]
  }
  const indent = /^\{\r?\n( +)"/.exec(text)?.[1]?.length ?? 0
  const temporary = `${CURSOR_CONFIG}.locust-probe.tmp`
  writeFileSync(temporary, `${JSON.stringify(config, null, indent)}${text.endsWith('\n') ? '\n' : ''}`)
  renameSync(temporary, CURSOR_CONFIG)
  const back = JSON.parse(readFileSync(CURSOR_CONFIG, 'utf8'))
  return MODEL_FIELDS.every((field) => JSON.stringify(back[field]) === JSON.stringify(kept[field])) ? 'put back' : 'NOT PUT BACK'
}

const PROMPT =
  'Look on the web: what is the newest stable Electron release listed on releases.electronjs.org today? ' +
  'Answer with just the version number, or say NO_WEB if you have no way to search the web or open a web page. Change nothing.'

const RUNTIMES = [
  { id: 'cursor', bin: 'cursor-agent', model: 'composer-2.5', build: createCursorPrintCommand, read: createCursorEventNormalizer },
  { id: 'copilot', bin: 'copilot', model: 'auto', build: createCopilotPromptCommand, read: createCopilotEventNormalizer },
  { id: 'antigravity', bin: 'agy', model: 'gemini-3.6-flash-low', build: createAgyPrintCommand, read: createAgyEventNormalizer }
].filter((runtime) => ONLY === undefined || ONLY.includes(runtime.id))

const locator = createPathExecutableLocator()
const runner = createNodeRuntimeProcessRunner()
const results = []

for (const runtime of RUNTIMES) {
  const executable = await locator.find(runtime.bin)
  if (executable === undefined) {
    console.log(`${runtime.id}: ${runtime.bin} is not on PATH`)
    results.push({ runtime: runtime.id, mode: '-', verdict: 'NOT FOUND' })
    continue
  }
  for (const sandbox of MODES) {
    const workspace = mkdtempSync(join(tmpdir(), `locust-web-${runtime.id}-`))
    if (runtime.id === 'cursor' && CURSOR_ALLOW !== undefined) {
      mkdirSync(join(workspace, '.cursor'))
      writeFileSync(join(workspace, '.cursor', 'cli.json'), `${JSON.stringify({ ...CURSOR_EXTRA, permissions: { allow: CURSOR_ALLOW, deny: [] } }, null, 2)}\n`)
      console.log(`\n(cursor: .cursor/cli.json allows ${CURSOR_ALLOW.join(', ')}${Object.keys(CURSOR_EXTRA).length > 0 ? `, with ${JSON.stringify(CURSOR_EXTRA)}` : ''})`)
    }
    const kept = runtime.id === 'cursor' ? keepCursorDefault() : undefined
    try {
      const spec = runtime.build(executable, { workspacePath: workspace, sandbox, prompt: PROMPT, model: runtime.model })
      const run = runner.start(spec, PROMPT)
      const normalizer = runtime.read({ runId: 'run_probe', missionId: 'mission_probe' })
      const events = []
      for await (const record of run.records) events.push(...normalizer.accept(record))
      const completion = await run.completion
      events.push(...normalizer.finish(completion))
      const tools = events
        .filter((event) => event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed')
        .map((event) => `${event.type.slice(5)} ${event.payload.name}${event.payload.command === undefined ? '' : ` ${String(event.payload.command).slice(0, 90)}`}${event.payload.status === undefined ? '' : ` [${event.payload.status}]`}`)
      const answer = new Map()
      for (const event of events) {
        if (event.type !== 'message.delta') continue
        const payload = event.payload
        answer.set(payload.itemId, payload.operation === 'replace' ? payload.text : `${answer.get(payload.itemId) ?? ''}${payload.text}`)
      }
      const reply = [...answer.values()].join(' | ').replace(/\s+/g, ' ').trim()
      const ended = events.at(-1)?.type
      const web = tools.some((line) => /web|fetch|search|browse|url|http/i.test(line))
      const verdict = /NO_WEB/.test(reply) ? 'NO WEB' : /\b44\.\d+\.\d+\b/.test(reply) ? (web ? 'SEARCHED' : 'ANSWERED, NO WEB TOOL SEEN') : 'UNCLEAR'
      results.push({ runtime: runtime.id, mode: sandbox, verdict })
      console.log(`\n${runtime.id} · ${sandbox} · ${runtime.model}: ${verdict} (ended ${ended ?? 'nothing'}, exit ${String(completion.exitCode)})`)
      console.log(`  reply: ${JSON.stringify(reply.slice(0, 240))}`)
      for (const line of tools.slice(0, 12)) console.log(`  tool ${line}`)
      const failed = events.find((event) => event.type === 'run.failed')
      if (failed !== undefined) console.log(`  failed: ${String(failed.payload.message).slice(0, 400)}`)
      if (ended !== 'run.completed' && completion.stderr.trim().length > 0) console.log(`  stderr: ${completion.stderr.trim().slice(0, 400)}`)
    } catch (error) {
      results.push({ runtime: runtime.id, mode: sandbox, verdict: 'ERROR' })
      console.log(`\n${runtime.id} · ${sandbox}: ERROR ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (kept !== undefined) console.log(`  Cursor default: ${putCursorDefaultBack(kept)}`)
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}

console.log('\nsummary')
for (const row of results) console.log(`  ${row.runtime.padEnd(12)} ${row.mode.padEnd(16)} ${row.verdict}`)
