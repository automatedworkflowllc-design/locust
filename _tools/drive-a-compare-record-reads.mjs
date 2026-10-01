// Your Compare record reads as a table once one is kept (0.519).
//
//   node _tools/drive-a-compare-record-reads.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-01, on Artificial Analysis's Optima: "might help improve
// our compare mode". Optima ends on a table -- each model's score, cost per
// task and time per task. Three decided comparisons are seeded (Mimo kept
// twice, Ling once; Muse never), each answer with its time and usage. Opening
// one must show, under the answers, every model with how often it was kept
// and its typical time and cost, the most kept first. Sends nothing.

import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'

const root = new URL('..', import.meta.url).pathname.slice(1)
const store = await import(pathToFileURL(join(root, 'packages', 'mission-store', 'dist', 'index.js')).href)
const workspace = await scratchRepository('locust-drive-compare-record-ws-')
const profilePath = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-compare-record-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const ledger = store.createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })
const TEAMMATE = { teammateId: 'tm_atlas0000000000000000', name: 'Atlas', hue: 'blue', role: 'Custom', roleTitle: 'Research', createdAt: '2026-09-05T05:00:00.000Z' }
const MODELS = {
  mimo: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash' },
  ling: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash' },
  muse: { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse Spark 1.3' }
}
// [ask, [model, seconds, output tokens] per column, kept column]
const COMPARES = [
  ['Summarize the vendor quotes', [['mimo', 20, 400], ['ling', 40, 900]], 'a'],
  ['Draft the launch email', [['mimo', 30, 500], ['muse', 60, 1200]], 'a'],
  ['Explain the build slowdown', [['ling', 50, 700], ['mimo', 40, 600]], 'a']
]
const owners = {}
const compares = []
let n = 0
for (const [index, [prompt, columns, kept]] of COMPARES.entries()) {
  const createdAt = new Date(Date.now() - (COMPARES.length - index) * 3_600_000).toISOString()
  const slots = []
  for (const [at, [which, seconds, out]] of columns.entries()) {
    n += 1
    const route = MODELS[which]
    const missionId = `mission_5e000000-0000-4000-8000-0005${String(n).padStart(8, '0')}`
    const runId = `run_5e0005${String(n)}`
    await ledger.createMission({
      missionId, runId, prompt,
      runtime: route.runtime, model: route.model, requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: null,
      workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt
    })
    const ended = new Date(Date.parse(createdAt) + seconds * 1000).toISOString()
    const event = (sequence, type, occurredAt, payload) => ({ id: `event_${String(n)}_${String(sequence)}`, runId, missionId, sequence, occurredAt, sourceAdapter: 'opencode', type, payload: { ...payload, evidence: { redacted: true } } })
    await ledger.appendEvents(missionId, [
      event(1, 'message.delta', createdAt, { itemId: 'answer', operation: 'append', text: `${route.label}'s answer to: ${prompt}.`, final: true }),
      event(2, 'run.completed', ended, { usage: { inputTokens: 2000, outputTokens: out }, process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 2, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: createdAt, finishedAt: ended } })
    ])
    owners[missionId] = TEAMMATE.teammateId
    slots.push({ slot: at === 0 ? 'a' : 'b', route: { runtime: route.runtime, model: route.model, label: route.label }, missionIds: [missionId] })
  }
  compares.push({ compareId: `cmp_${String(index + 1)}`, teammateId: TEAMMATE.teammateId, prompt, createdAt, slots, kept: { slot: kept, at: createdAt } })
}
await ledger.flush?.()
await writeFile(join(profilePath, 'compares.json'), JSON.stringify({ schemaVersion: 1, compares }), 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `compare-record-${tag}`,
  port: 9839,
  workspace,
  profilePath,
  sendsNothing: true,
  outPath: join(recordRoot('a-compare-record-reads-2026-10-01'), tag),
  seed: { schemaVersion: 1, teammates: [TEAMMATE], missionOwners: owners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)
  const opened = JSON.parse(String(await drive.capture('a kept comparison, opened', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-convrow button.lc-conv')].find((r) => /build slowdown/i.test(r.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1500))
    ;[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Open the comparison')?.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 800))
    const record = document.querySelector('.lc-compare__record')
    record?.scrollIntoView()
    await new Promise((r) => setTimeout(r, 300))
    return JSON.stringify({
      compare: !!document.querySelector('.lc-compare'),
      label: record?.querySelector('.lc-compare__recordlabel')?.innerText.trim() ?? '',
      head: [...(record?.querySelectorAll('th') ?? [])].map((c) => c.innerText.trim()),
      rows: [...(record?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.querySelectorAll('td')].map((c) => c.innerText.trim())),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    })
  })()`))))
  check('the comparison opens, with YOUR RECORD under the answers', opened.compare && opened.label === 'YOUR RECORD' && opened.head.join('|') === 'Model|Kept|Typical time|Typical cost', JSON.stringify(opened))
  const names = opened.rows.map((row) => row[0])
  check('every model compared, the most kept first', names.join('|') === 'Mimo V2.6 Flash|Ling 3.0 Flash|Muse Spark 1.3', JSON.stringify(opened.rows))
  check('each with how often it was kept', opened.rows.map((row) => row[1]).join('|') === '2 of 3|1 of 2|0 of 1', JSON.stringify(opened.rows))
  check('and its typical time and cost', opened.rows[0]?.[2] === '30s' && /out/.test(opened.rows[0]?.[3] ?? '') && opened.rows[2]?.[2] === '1m 00s', JSON.stringify(opened.rows))
  check('nothing scrolls sideways', opened.overflow <= 0, String(opened.overflow))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Three decided comparisons seeded; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
