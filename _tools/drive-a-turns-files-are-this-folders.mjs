// A turn's changed files count this folder's, once each (0.629).
//
//   node _tools/drive-a-turns-files-are-this-folders.mjs [--packaged <exe>] [--tag <name>]
//
// The RPG round's resumed Sonnet column read "Edited 19 files", every row "Claude Code did not report",
// beside a footer that said one file changed: Writes into a scratch folder outside the compare copy counted
// as the turn's files, a file written then edited counted twice, and calls cut off by the stop read as
// Claude Code's failure. This seeds one finished Claude turn of that shape -- four Writes outside the
// folder, one outside file written then edited, index.html written inside, one Write that never reported --
// opens it, and reads the turn's foot and rows. Sends nothing.

import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUTSIDE = 'C:/locust-drive-elsewhere/scratch'

const root = new URL('..', import.meta.url).pathname.slice(1)
const store = await import(pathToFileURL(join(root, 'packages', 'mission-store', 'dist', 'index.js')).href)
const workspace = await scratchRepository('locust-drive-turn-files-ws-')
const profilePath = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-turn-files-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const ledger = store.createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })
const missionId = 'mission_10000000-0000-4000-8000-000000000629'
const runId = 'run_turn_files'
const at = new Date(Date.now() - 3_600_000).toISOString()
await ledger.createMission({
  missionId, runId, prompt: 'carry on', runtime: 'claude', model: 'claude-sonnet-5-5', requestedRouteId: 'claude',
  resolvedRouteId: 'claude-account:default', cliVersion: null, workspaceId, sandbox: 'workspace-write', executionPolicyVersion: 1, createdAt: at
})
let sequence = 0
const event = (type, payload) => {
  sequence += 1
  return { id: `event_${String(sequence)}`, runId, missionId, sequence, occurredAt: at, sourceAdapter: 'claude', type, payload: { ...payload, evidence: { redacted: true } } }
}
const write = (id, name, path, settled = true) => [
  event('tool.started', { itemId: id, toolKind: 'tool_use', name, phase: 'started' }),
  event('tool.started', { itemId: id, toolKind: 'tool_use', name, command: path, phase: 'started' }),
  ...(settled ? [event('tool.completed', { itemId: id, toolKind: 'tool_use', name, command: path, phase: 'completed' })] : [])
]
const events = [
  event('run.started', { runtimeThreadId: 'session-turn-files' }),
  event('message.delta', { itemId: 'm1', operation: 'append', text: 'Continuing from where I stopped.', final: true }),
  ...['cdp.mjs', 'play.mjs', 'patch5.mjs', 't3.mjs'].flatMap((name, index) => write(`w${String(index)}`, 'Write', `${OUTSIDE}/${name}`)),
  ...write('same1', 'Write', `${OUTSIDE}/profile.mjs`),
  ...write('same2', 'Edit', `${OUTSIDE}/profile.mjs`),
  ...write('inside', 'Write', 'index.html'),
  ...write('cut', 'Write', `${OUTSIDE}/half.mjs`, false),
  event('message.delta', { itemId: 'm2', operation: 'append', text: 'The game is finished.', final: true })
]
events.push(event('run.completed', { usage: { inputTokens: 900, outputTokens: 90 }, process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: events.length, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: at, finishedAt: at } }))
await ledger.appendEvents(missionId, events)
await ledger.flush()

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-turns-files-are-this-folders-${tag}`, port: 9928, workspace, profilePath, sendsNothing: true,
  outPath: join(recordRoot('a-turns-files-are-this-folders-2026-10-05'), tag),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await sleep(2500)
  const seen = JSON.parse(String(await drive.capture('the turn, opened, its rows unfolded', () => drive.evaluate(`(async () => {
    let row
    for (let i = 0; i < 40 && !row; i += 1) {
      row = [...document.querySelectorAll('.lc-conv')].find((one) => /carry on/.test(one.textContent))
      if (!row) await new Promise((r) => setTimeout(r, 500))
    }
    row?.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-thread .lc-agentline__body'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1000))
    for (const line of document.querySelectorAll('.lc-thread .lc-activity[aria-expanded="false"]')) line.click()
    await new Promise((r) => setTimeout(r, 1000))
    const thread = document.querySelector('.lc-thread')?.innerText ?? ''
    return JSON.stringify({ opened: Boolean(row), edited: /Edited (\\d+) files?/.exec(thread)?.[0] ?? null, stopped: thread.includes('stopped before it reported'), blamed: thread.includes('Claude Code did not report') })
  })()`))))
  check('the turn opens', seen.opened === true, JSON.stringify(seen))
  check('its changed files are this folder\'s, once each: "Edited 1 file"', seen.edited === 'Edited 1 file', JSON.stringify(seen))
  check('the call cut off by the stop says "stopped before it reported"', seen.stopped === true, JSON.stringify(seen))
  check('no row blames Claude Code for a call it was stopped in', seen.blamed === false, JSON.stringify(seen))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. One finished turn with writes outside its folder, opened from its record.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
