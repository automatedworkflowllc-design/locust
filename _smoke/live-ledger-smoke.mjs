// Live smoke: a real Codex process through the product's own discovery,
// transport, normalizer and durable ledger, then recovered from disk by a
// fresh reader instance.
//
// This is the verification owed after the ledger reader/writer parity fix: the
// unit suites drive a fake runner, so only a real provider exercises the whole
// path with strings the product did not author.
//
//   node _smoke/live-ledger-smoke.mjs
//
// Exits non-zero on any failed assertion. Ledger goes to a temp dir, removed
// afterwards. Codex is not on PATH on this machine, so the locator is handed an
// environment with its install directory prepended -- the product's own
// discovery code still does the finding.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const adapters = await import(
  new URL('../packages/runtime-adapters/dist/index.js', import.meta.url).href
)
const store = await import(
  new URL('../packages/mission-store/dist/index.js', import.meta.url).href
)

const {
  createCodexEventNormalizer,
  createCodexExecCommand,
  createNodeProbeRunner,
  createNodeRuntimeProcessRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes
} = adapters
const { createFileMissionLedger } = store

const CODEX_BIN_DIR = join(homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'b99306303521e97e')
const WORKSPACE = process.cwd()
const PROMPT = 'Reply with exactly LIVE_LEDGER_OK and nothing else. Do not read files or run tools.'

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const root = await mkdtemp(join(tmpdir(), 'locust-live-smoke-'))
try {
  console.log('1. discovery')
  const runtimes = await discoverInstalledRuntimes({
    runner: createNodeProbeRunner(),
    locator: createPathExecutableLocator({
      environment: { ...process.env, PATH: `${CODEX_BIN_DIR};${process.env.PATH ?? ''}` }
    }),
    includeOmniRoute: false
  })
  const codex = runtimes.find((r) => r.id === 'codex')
  check('codex discovered and ready', codex?.readiness === 'ready',
    `${codex?.readiness} / ${codex?.version?.version ?? 'no version'}`)
  if (codex?.readiness !== 'ready' || codex.executable === undefined) {
    console.log(JSON.stringify(codex?.diagnostics ?? [], null, 2))
    process.exit(1)
  }

  console.log('2. real read-only mission, persisted as it streams')
  const runId = `run_${randomUUID()}`
  const missionId = `mission_${randomUUID()}`
  const cliVersion = codex.version?.version
  const ledger = createFileMissionLedger({ rootDirectory: root })

  await ledger.createMission({
    missionId,
    runId,
    prompt: PROMPT,
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: cliVersion ?? null,
    workspaceId: 'ws_livesmoke',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: new Date().toISOString()
  })

  const normalizer = createCodexEventNormalizer({
    runId,
    missionId,
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    ...(cliVersion === undefined ? {} : { cliVersion })
  })

  const command = createCodexExecCommand(codex.executable, { workspacePath: WORKSPACE })
  const run = createNodeRuntimeProcessRunner().start(command, PROMPT, {})

  let persisted = 0
  const types = []
  const diagnostics = []
  for await (const record of run.records) {
    const events = normalizer.accept(record)
    if (events.length === 0) continue
    await ledger.appendEvents(missionId, events)
    persisted += events.length
    for (const event of events) {
      types.push(event.type)
      if (event.type === 'adapter.diagnostic') diagnostics.push(event)
    }
  }
  const terminal = normalizer.finish(await run.completion)
  if (terminal.length > 0) {
    await ledger.appendEvents(missionId, terminal)
    persisted += terminal.length
    for (const event of terminal) {
      types.push(event.type)
      if (event.type === 'adapter.diagnostic') diagnostics.push(event)
    }
  }
  await ledger.flush()
  check('events persisted during the run', persisted > 0, `${persisted} events`)
  console.log(`       ${types.join(', ')}`)
  for (const event of diagnostics) {
    console.log(`       diagnostic: ${event.payload.level} ${event.payload.code} -- ${event.payload.message}`)
  }

  console.log('3. recovery by a fresh reader')
  const reopened = createFileMissionLedger({ rootDirectory: root })
  const recovered = await reopened.getMission(missionId)

  check('mission recovered', recovered !== undefined)
  check('no integrity issues', (recovered?.issues.length ?? -1) === 0,
    JSON.stringify(recovered?.issues ?? []))
  check('phase is completed, not interrupted', recovered?.phase === 'completed', recovered?.phase)
  check('every persisted event survived the round trip',
    recovered?.events.length === persisted, `${recovered?.events.length ?? 0} of ${persisted}`)
  check('sequence contiguous from 1',
    (recovered?.events ?? []).every((e, i) => e.sequence === i + 1))
  check('the model answer is in the durable record',
    JSON.stringify(recovered?.events ?? []).includes('LIVE_LEDGER_OK'))

  // The defect this smoke exists for: a field the writer accepted and the
  // reader refuses truncates a COMPLETED mission on the next launch, silently.
  // Assert on the recovered strings themselves, not on their JSON encoding --
  // JSON.stringify escapes NUL, so searching stringified output for one can
  // never fail.
  const strings = []
  const walk = (v) => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(recovered?.events ?? [])
  const NUL = String.fromCharCode(0)
  check('no NUL on the durable record', strings.every((s) => !s.includes(NUL)),
    `${strings.length} strings checked`)
  check('no identity field over the reader cap',
    (recovered?.events ?? []).every((e) => {
      const p = e.payload ?? {}
      return [p.itemId, p.itemType, p.toolKind, p.name, p.status]
        .every((v) => v === undefined || (typeof v === 'string' && v.length <= 512))
    }))

  const listed = await reopened.listMissions({ limit: 5 })
  check('mission appears in history', listed.missions.some((m) => m.metadata.missionId === missionId))

  // ---- Negative control -----------------------------------------------
  // Everything above is green. A green check that could never go red proves
  // nothing, so reproduce the exact defect class on a COPY of this run's
  // ledger and require the same assertions to fail. If a NUL smuggled into a
  // durable record still recovers clean and complete, the checks above are
  // inert and this whole script is decoration.
  console.log('4. negative control -- the same checks must go red on a corrupted ledger')
  const controlRoot = await mkdtemp(join(tmpdir(), 'locust-live-control-'))
  try {
    const source = join(root, `${missionId}.jsonl`)
    const LF = String.fromCharCode(10)
    const lines = (await readFile(source, 'utf8')).split(LF).filter((line) => line.length > 0)
    // Put a NUL inside a body record's text -- valid JSON, fsynced happily by
    // the writer, and refused by the reader. This is the production failure:
    // the file is intact and the mission comes back truncated.
    const target = lines.findIndex((line) => line.includes('message.delta'))
    if (target < 0) throw new Error('control needs a message.delta record to corrupt')
    const parsed = JSON.parse(lines[target])
    parsed.event.payload = { ...parsed.event.payload, text: `poisoned${NUL}text` }
    lines[target] = JSON.stringify(parsed)
    await writeFile(join(controlRoot, `${missionId}.jsonl`), lines.join(LF) + LF, 'utf8')

    const poisoned = await createFileMissionLedger({ rootDirectory: controlRoot }).getMission(missionId)
    const truncated = (poisoned?.events.length ?? 0) < persisted
    const flagged = (poisoned?.issues.length ?? 0) > 0
    check('CONTROL: corrupted ledger recovers fewer events', truncated,
      `${poisoned?.events.length ?? 0} of ${persisted}`)
    check('CONTROL: corrupted ledger is reported as an integrity issue', flagged,
      JSON.stringify(poisoned?.issues ?? []))
    check('CONTROL: corrupted ledger no longer reads as completed',
      poisoned?.phase !== 'completed', poisoned?.phase)
  } finally {
    await rm(controlRoot, { recursive: true, force: true })
  }

  console.log(`\n${failures === 0 ? 'LIVE SMOKE PASSED' : `LIVE SMOKE FAILED (${failures})`}`)
} finally {
  await rm(root, { recursive: true, force: true })
}

process.exit(failures === 0 ? 0 : 1)
