// A real Muse Code run, end to end, for nothing.
//
//   node _tools/drive-muse-echo.mjs
//   node _tools/drive-muse-echo.mjs --prompt "Reply with exactly PING"
//   node _tools/drive-muse-echo.mjs --write   # let the run change its folder
//
// What this measures, and what it deliberately does not:
//
// It runs the REAL pieces -- `createMuseExecCommand` builds the argv, the
// real process runner spawns `muse.cmd` and writes the prompt to a file
// because the spec says `prompt-file`, and `createMuseEventNormalizer` reads
// what comes back. If the prompt never arrives, or the placeholder is left
// in argv, or the normalizer misreads the envelope, it shows up here.
//
// The ONE thing added that a mission would not add is `--provider echo`. The
// echo provider needs no account and contacts no model, so this spends
// nothing -- which is the whole reason it can be run at all. A run under a
// paying provider would exercise the same path with a model on the end of
// it, and nobody has done that, so no tool call has ever been measured. Do
// not read a clean run here as evidence that tool rows are right.
//
// Requires Muse Code on PATH. `muse --version` should print `Muse Code 1.3.x`.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createMuseEventNormalizer,
  createMuseExecCommand,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator
} from '../packages/runtime-adapters/dist/index.js'

const argumentAfter = (flag) => {
  const at = process.argv.indexOf(flag)
  return at === -1 ? undefined : process.argv[at + 1]
}
const PROMPT = argumentAfter('--prompt') ?? 'Reply with exactly PING'
const SANDBOX = process.argv.includes('--write') ? 'workspace-write' : 'read-only'

const executable = await createPathExecutableLocator().find('muse')
if (executable === undefined) {
  console.error('muse is not on PATH. Install Muse Code, or open a new shell if it was just installed.')
  process.exit(1)
}
console.log(`muse: ${executable.executablePath} (${executable.kind})`)

// Somewhere disposable for the run to stand in, so a write-mode drive cannot
// touch this repository.
const workspace = mkdtempSync(join(tmpdir(), 'locust-muse-drive-'))

try {
  const spec = createMuseExecCommand(executable, {
    workspacePath: workspace,
    sandbox: SANDBOX,
    prompt: PROMPT
  })
  if (spec.stdin !== 'prompt-file') {
    throw new Error(`Muse should take its prompt in a file; the spec says ${spec.stdin}.`)
  }
  // The free provider, and the only thing here a mission would not send.
  //
  // Spliced in after Muse's own `exec`, not put on the front. On Windows the
  // spec's argv starts with the shim's own arguments -- `/s /c <muse.cmd>`
  // for a cmd shim -- and a flag placed before those is an argument to
  // cmd.exe, not to Muse. Measured the wrong way round first: the run
  // reached Muse anyway, ignored the flag, and died asking to be logged in.
  const args = [...spec.args]
  const execAt = args.lastIndexOf('exec')
  if (execAt === -1) throw new Error('The Muse command no longer takes an exec argument.')
  args.splice(execAt + 1, 0, '--provider', 'echo')
  console.log(`argv: ${args.join(' ')}`)

  const runner = createNodeRuntimeProcessRunner()
  const run = runner.start({ ...spec, args }, PROMPT)
  const normalizer = createMuseEventNormalizer({ runId: 'run_drive', missionId: 'mission_drive', cliVersion: '1.3.0' })

  const events = []
  let records = 0
  for await (const record of run.records) {
    records += 1
    events.push(...normalizer.accept(record))
  }
  const completion = await run.completion
  events.push(...normalizer.finish(completion))

  console.log(`\nrecords: ${String(records)}   exit: ${String(completion.exitCode)}`)
  console.log(`session: ${normalizer.runtimeThreadId ?? '(none)'}`)
  if (completion.stderr.trim().length > 0) {
    console.log(`stderr: ${completion.stderr.trim().split('\n').join('\n        ')}`)
  }

  console.log('\nevents')
  const answer = new Map()
  for (const event of events) {
    const payload = event.payload
    let detail = ''
    if (event.type === 'message.delta') {
      answer.set(payload.itemId, payload.operation === 'replace' ? payload.text : `${answer.get(payload.itemId) ?? ''}${payload.text}`)
      detail = `${payload.operation}${payload.final ? ' final' : ''} ${JSON.stringify(payload.text)}`
    } else if (event.type.startsWith('tool.')) {
      detail = `${payload.name}${payload.command === undefined ? '' : ` ${payload.command}`}${payload.status === undefined ? '' : ` [${payload.status}]`}`
    } else if (event.type === 'adapter.diagnostic') {
      detail = `${payload.level} ${payload.code}: ${payload.message}`
    } else if (event.type === 'run.failed') {
      detail = `${payload.runtimeTerminal} -- ${payload.message}`
    }
    console.log(`  ${String(event.sequence).padStart(2, ' ')}  ${event.type.padEnd(20, ' ')} ${detail}`)
  }

  console.log('\nanswer')
  for (const [itemId, text] of answer) console.log(`  ${itemId}: ${JSON.stringify(text)}`)

  const ended = events[events.length - 1]?.type
  console.log(`\nverdict: ${ended === 'run.completed' ? 'the run completed and was read end to end' : `the run ended as ${ended ?? 'nothing'}`}`)
  process.exitCode = ended === 'run.completed' ? 0 : 1
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
