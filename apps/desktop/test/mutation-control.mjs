// Mutation control for the renderer's status derivations and the approval layer.
//
// These functions decide whether the shell may call a runtime live, whether a
// teammate reads as blocked, and whether a receipt prints `verified`. The
// product's entire claim is that those words are trustworthy, so a green suite
// over them is not enough -- each invariant must be shown to fail when broken.
//
//   node test/mutation-control.mjs
//
// Breaks one behaviour at a time, requires the NAMED test to fail, rejects any
// mutation that stops the file running, and restores every file it touches.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATUS = join(ROOT, 'src', 'renderer', 'src', 'status.ts')
const APPROVALS = join(ROOT, 'src', 'main', 'app-server-mission.ts')
const HANDOFF = join(ROOT, 'src', 'main', 'handoff.ts')
const MISSIONS = join(ROOT, 'src', 'main', 'codex-mission.ts')
const PEERS = join(ROOT, 'src', 'main', 'peer-exchange.ts')
const BRIEFING = join(ROOT, 'src', 'main', 'workroom-briefing.ts')
const SHARE = join(ROOT, 'src', 'shared', 'peer-share.ts')
const VIEW = join(ROOT, 'src', 'renderer', 'src', 'missionView.ts')

const MUTATIONS = [
  {
    file: BRIEFING,
    name: 'a received message is quoted with its share tags intact',
    from: '  const body = sanitizeInbound(message.text).replace(/\\n/g, \'\\n  \')',
    to: '  const body = message.text.replace(/\\n/g, \'\\n  \')',
    expect: 'defangs a share tag inside a received message so it cannot be echoed as a share'
  },
  {
    file: BRIEFING,
    name: 'messages that do not fit are sent anyway',
    from: '  while (prompt.length > MAX_RUNTIME_PROMPT_LENGTH && delivered.length > 0) {',
    to: '  while (false) {',
    expect: 'leaves out messages that do not fit, from the newest end, and counts them as still waiting'
  },
  {
    file: BRIEFING,
    name: 'a teammate with nobody to share with is still told how',
    from: '  const trailer = input.peer.others.length > 0 ? rosterSection(input.peer) : undefined',
    to: '  const trailer = rosterSection(input.peer)',
    expect: 'lists the other teammates and the exact share form, and only when there is someone to share with'
  },
  {
    file: SHARE,
    name: 'an upper-case share tag in a received message is left armed',
    from: "  return text.replace(/<(\\/?)locust-share/gi, '‹$1locust-share')",
    to: "  return text.replace(/<(\\/?)locust-share/g, '‹$1locust-share')",
    expect: 'defangs an inbound share tag so a received message cannot be echoed as a share'
  },
  {
    file: SHARE,
    name: 'the bubble keeps its share blocks',
    from: "  return text.replace(BLOCK, '').replace(/\\n{3,}/g, '\\n\\n').trimEnd()",
    to: '  return text.trimEnd()',
    expect: 'removes the blocks from the transcript and leaves the prose'
  },
  {
    file: PEERS,
    name: 'a share addressed to a stranger goes to the first teammate instead',
    from: '        const target = peer.others.find((entry) => entry.name.toLowerCase() === block.to.toLowerCase())',
    to: '        const target = peer.others[0]',
    expect: 'refuses a share addressed to someone who is not on the roster, out loud'
  },
  {
    file: MISSIONS,
    name: 'a run that did not complete still shares',
    from: '    if (mission.transcript.completed && mission.peer !== undefined && peerExchange !== undefined) {',
    to: '    if (mission.peer !== undefined && peerExchange !== undefined) {',
    expect: 'shares nothing from a run that did not complete'
  },
  {
    file: MISSIONS,
    name: 'the runtime is sent the bare prompt, never the briefing',
    from: '          process = options.runner.start(command, runtimePrompt, { signal: controller.signal })',
    to: '          process = options.runner.start(command, prompt, { signal: controller.signal })',
    expect: 'quotes a waiting message into the prompt as a claim, records it, and marks it delivered only once the run is live'
  },
  {
    file: MISSIONS,
    name: 'the ledger records the briefing as what the person said',
    from: '            runId,\n            prompt,\n            runtime,',
    to: '            runId,\n            prompt: runtimePrompt,\n            runtime,',
    expect: "keeps the person's own words as the recorded prompt, not the briefing"
  },
  {
    file: MISSIONS,
    name: 'a mission runs on messages its ledger could not record',
    from: '            await peerExchange.recordReceived(missionId, delivered, createdAt)',
    to: '            await Promise.resolve()',
    expect: 'refuses to run on messages the ledger cannot record, and says so'
  },
  {
    file: VIEW,
    name: 'the agent bubble shows the share block too',
    from: '    const text = stripShareBlocks(message.text)',
    to: '    const text = message.text',
    expect: 'hides a share block from the agent bubble, keeping the prose'
  },
  {
    file: VIEW,
    name: 'a received exchange is filed as sent-only',
    from: "    if (message.direction === 'received') group.received = true\n",
    to: '',
    expect: 'groups an exchange by the other party and marks whether anything was received'
  },
  {
    file: STATUS,
    name: 'a stale ready flag alone is enough to call a runtime usable',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.ready',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    file: STATUS,
    name: 'a ready probe alone is enough, ignoring the readiness flag',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.status === \'ready\'',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    file: STATUS,
    name: 'a half-built adapter is advertised as ready',
    from: '      tag: \'PREVIEW\',',
    to: '      tag: \'READY\',',
    expect: 'never calls a half-built adapter live, even when its runtime is ready'
  },
  {
    file: STATUS,
    name: 'a planned runtime becomes selectable',
    from: '      tag: \'PLANNED\',\n      selectable: false,',
    to: '      tag: \'PLANNED\',\n      selectable: true,',
    expect: 'keeps a planned runtime non-interactive whatever discovery says'
  },
  {
    file: STATUS,
    name: 'every discovered runtime counts as connected',
    from: '  return runtimes.filter(runtimeIsUsable).length',
    to: '  return runtimes.length',
    expect: 'counts only usable runtimes as connected'
  },
  {
    file: STATUS,
    name: 'a blocked runtime is hidden behind an optimistic running mission',
    from: '  if (input.runtime === undefined || !runtimeIsUsable(input.runtime)) {',
    to: '  if (false) {',
    expect: 'reports a blocked runtime even while a mission looks like it is running'
  },
  {
    file: STATUS,
    name: 'a completed mission prints clean over an unreadable ledger',
    from: '  if (hasIntegrityIssues) {',
    to: '  if (false) {',
    expect: 'will not present a completed mission as clean when its ledger is not'
  },
  {
    file: STATUS,
    name: 'the receipt says verified regardless of integrity issues',
    from: '  return integrityIssueCount === 0 ? \'verified\' : \'incomplete\'',
    to: '  return \'verified\'',
    expect: 'will not present a completed mission as clean when its ledger is not'
  },
  {
    file: APPROVALS,
    name: 'an unrecognized approval request is approved rather than refused',
    from: "            return { decision: 'reject' }",
    to: "            return { decision: 'accept' }",
    expect: 'refuses a request it does not understand rather than guessing'
  },
  {
    file: APPROVALS,
    name: 'always-allow becomes a durable grant instead of a session one',
    from: "  if (decision === 'approve-always') return 'acceptForSession'",
    to: "  if (decision === 'approve-always') return 'acceptForever'",
    expect: 'maps the product answers onto the protocol'
  },
  {
    file: APPROVALS,
    name: 'a dead runtime leaves approvals pending forever',
    from: "        for (const [, pending] of approvals) pending.resolve({ decision: 'reject' })\n        approvals.clear()\n        active = undefined",
    to: '        active = undefined',
    expect: 'releases a pending approval when the runtime dies'
  },
  {
    file: APPROVALS,
    name: 'an already-answered approval can be answered again',
    from: '      if (pending === undefined) return false',
    to: '      if (pending === undefined) return true',
    expect: 'ignores a decision for an unknown or already-answered approval'
  },
  {
    file: APPROVALS,
    name: 'an undescribed command is presented as an ordinary one',
    from: "      summary: command.length > 0 ? 'Run a command' : 'Run a command it did not describe',",
    to: "      summary: 'Run a command',",
    expect: 'says so plainly when the runtime described nothing'
  },
  {
    file: STATUS,
    name: 'the control offers a handoff before the mission has a runId',
    from: "  return hasRunId ? 'available' : 'starting'",
    to: "  return 'available'",
    expect: 'offers a handoff only once the mission has a runId to address'
  },
  {
    file: STATUS,
    name: 'a second switch may race one already in flight',
    from: "  if (switching) return 'switching'",
    to: '',
    expect: 'refuses a second switch while one is in flight'
  },
  {
    file: STATUS,
    name: 'a finished mission still offers a handoff',
    from: "  if (!running) return 'idle'",
    to: '',
    expect: 'offers nothing when no mission is running'
  },
  {
    file: STATUS,
    name: 'a control that cannot do its job stays silent about why',
    from: "  if (availability === 'starting') return 'Waiting for the mission to start before it can be handed over'",
    to: '',
    expect: 'says why whenever the control cannot do its job'
  },
  {
    file: HANDOFF,
    name: 'the briefing tells the next runtime an unsettled action is done',
    from: "        'These actions STARTED and never reported back. Whether each took effect is unknown. '",
    to: "        'These actions were completed. '",
    expect: 'tells the new runtime to verify actions that never reported back'
  },
  {
    file: HANDOFF,
    name: 'the optional sections are ordered by size rather than by risk',
    from: '  return sections\n}',
    to: '  return sections.slice(0, 1).concat(sections.slice(1).reverse())\n}',
    expect: 'separates what finished from what did not'
  },
  {
    file: HANDOFF,
    name: 'the reserve is too small for the notice it has to hold',
    from: 'export const NOTICE_BUDGET = 120',
    to: 'export const NOTICE_BUDGET = 40',
    expect: 'reserves room for the longest notice every optional section could produce'
  },
  {
    file: HANDOFF,
    name: 'the omission notice is dropped, so a trimmed brief reads as complete',
    from: '    : `${kept.join(\'\\n\\n\')}\\n\\n${omissionNotice(omitted)}`',
    to: '    : kept.join(\'\\n\\n\')',
    expect: 'says so when detail was left out, rather than reading as complete'
  },
  {
    file: HANDOFF,
    name: 'the notice budget is reserved only after the first drop',
    from: '  const budget = MAX_HANDOFF_PROMPT_LENGTH - (sections.length > 1 ? NOTICE_BUDGET : 0)',
    to: '  const budget = MAX_HANDOFF_PROMPT_LENGTH',
    expect: 'reserves enough room for the longest possible omission notice'
  },
  {
    file: MISSIONS,
    name: 'the checkpoint is taken before the stopped run has settled',
    from: '      previous.controller.abort()\n      await Promise.allSettled([...consumeOperations])',
    to: '      previous.controller.abort()',
    expect: 'reconciles only after the stopped run has settled'
  },
  {
    file: MISSIONS,
    name: 'a handoff to the same runtime restarts the run instead of refusing',
    from: '      if (previous.runtime === runtime) {',
    to: '      if (false) {',
    expect: 'refuses a handoff to the runtime already running it, without stopping anything'
  },
  {
    file: MISSIONS,
    name: 'an unreconcilable ledger is handed off anyway',
    from: "      if (checkpoint.resumeSafety === 'unsafe') {",
    to: '      if (false) {',
    expect: 'refuses when the ledger cannot be reconciled, and says the run is stopped'
  },
  {
    file: MISSIONS,
    name: 'the continuation is not recorded, so the new mission looks unrelated',
    from: '            ...(continuation === undefined ? {} : { continuesFrom: continuation })',
    to: '            ...{}',
    expect: 'starts a NEW mission that records what it continues from'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report first: a run that dies before writing one would otherwise
  // leave the previous report in place and read as "this mutation broke
  // nothing" -- a check that cannot go red, inside the tool that exists to
  // prove checks can.
  rmSync(REPORT, { force: true })
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter', 'json', '--outputFile', 'mutation-result.json'], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true
    })
  } catch {
    // A red suite exits non-zero; the report is what we read, not the status.
  }
  if (!existsSync(REPORT)) return { failed: [], unparseable: true, total: -1 }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'))
  const failed = []
  let unparseable = false
  for (const file of report.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) unparseable = true
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') failed.push(assertion.title)
    }
  }
  return { failed, unparseable, total: report.numTotalTests ?? 0 }
}

const originals = new Map([
  [STATUS, readFileSync(STATUS, 'utf8')],
  [APPROVALS, readFileSync(APPROVALS, 'utf8')],
  [HANDOFF, readFileSync(HANDOFF, 'utf8')],
  [MISSIONS, readFileSync(MISSIONS, 'utf8')],
  [PEERS, readFileSync(PEERS, 'utf8')],
  [BRIEFING, readFileSync(BRIEFING, 'utf8')],
  [SHARE, readFileSync(SHARE, 'utf8')],
  [VIEW, readFileSync(VIEW, 'utf8')]
])
let problems = 0

try {
  const baseline = runSuite()
  if (baseline.failed.length > 0) {
    console.error(`baseline is not green: ${baseline.failed.join(', ')}`)
    process.exit(1)
  }
  console.error(`baseline green (${baseline.total} tests)\n`)

  for (const mutation of MUTATIONS) {
    const target = mutation.file
    const original = originals.get(target)
    if (!original.includes(mutation.from)) {
      console.error(`  [SKIP] ${mutation.name} -- anchor not found`)
      problems += 1
      continue
    }
    writeFileSync(target, original.replace(mutation.from, mutation.to), 'utf8')
    const result = runSuite()
    writeFileSync(target, original, 'utf8')

    if (result.unparseable || result.total !== baseline.total) {
      console.error(`  [INVALID] ${mutation.name} -- the file stopped running, so this red means nothing`)
      problems += 1
      continue
    }
    const caught = result.failed.includes(mutation.expect)
    if (!caught) problems += 1
    console.error(
      `  [${caught ? 'CAUGHT' : 'SURVIVED'}] ${mutation.name}` +
        (caught ? '' : `\n            expected "${mutation.expect}" to fail; failures: ${result.failed.join(', ') || 'none'}`)
    )
  }
} finally {
  for (const [file, text] of originals) writeFileSync(file, text, 'utf8')
  rmSync(REPORT, { force: true })
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
