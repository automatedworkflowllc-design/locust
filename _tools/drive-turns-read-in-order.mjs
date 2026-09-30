// A turn reads in the order it happened (0.491), on REAL turns.
//
//   node _tools/drive-turns-read-in-order.mjs [--packaged <exe>] [--tag <name>] [--missions id,id,...]
//
// Colin, 2026-09-30: "compared to claude code, ALL of our commands and stuff
// that would appear batched on screen seem to all get rolled into the bar".
// Copies finished missions from this machine's own ledger into a scratch
// profile (their folder rewritten to the drive's, each its own conversation),
// opens each, and photographs how it reads: what was said, each group of
// steps as one line, a group opened, the turn's foot. Sends nothing.
//
// The record holds the person's own conversations, so it is written under
// LOCUST_SCRATCH, never into docs/.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const SCRATCH = process.env.LOCUST_SCRATCH ?? tmpdir()
const LEDGER = arg('--ledger') ?? join(process.env.APPDATA ?? '', '@teammate', 'desktop', 'mission-ledger')
const MISSIONS = (arg('--missions') ?? '79f6d728-1b1f-48af-9c1e-62b07d8fe40c,cdfab7a8-76f0-4f56-bf8c-02be653c751a,52079851-50bb-4265-a83b-db3c67569766,2f0bffe3-6b25-45c2-b851-474d9977dc01').split(',')
const OUT = await mkdtemp(join(SCRATCH, `turns-read-in-order-${tag}-`))

const workspace = await scratchRepository('locust-drive-turns-ws-')
const profilePath = await mkdtemp(join(SCRATCH, 'locust-drive-turns-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
await mkdir(join(profilePath, 'mission-ledger'), { recursive: true })
const WREN = { teammateId: 'tm_aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-08-10T09:00:00.000Z' }
const missionOwners = {}
for (const id of MISSIONS) {
  const file = `mission_${id}.jsonl`
  const lines = (await readFile(join(LEDGER, file), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const created = lines.find((record) => record.recordType === 'mission.created')
  created.metadata.workspaceId = workspaceId
  delete created.metadata.continuesFrom
  // Each its own conversation of the person's, not a hand-off nested under one that is not here.
  delete created.metadata.startedBy
  await writeFile(join(profilePath, 'mission-ledger', file), `${lines.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
  missionOwners[created.metadata.missionId] = WREN.teammateId
}
say(`copied ${String(MISSIONS.length)} real missions into a scratch profile; workspace ${workspaceId} at ${workspace}`)

const drive = await startDrive({
  name: `turns-read-in-order-${tag}`, port: 9795, workspace, profilePath, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [WREN], missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const READ = `(() => {
  const thread = document.querySelector('.lc-thread')
  const bodies = [...(thread?.querySelectorAll('.lc-agentline__body') ?? [])]
  const order = bodies.map((body) => {
    const steps = body.querySelector('.lc-steps__line')
    return steps !== null ? 'STEPS ' + steps.innerText.replace(/\\s+/g, ' ').trim() : 'SAID ' + body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)
  }).filter((line) => line.length > 6)
  return JSON.stringify({
    order,
    groups: thread?.querySelectorAll('.lc-steps').length ?? 0,
    oldBar: thread?.querySelectorAll('.lc-activity:not(.lc-turnfoot .lc-activity)').length ?? 0,
    foot: thread?.querySelector('.lc-turnfoot__trace')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
    files: thread?.querySelector('.lc-turnfoot .lc-activity')?.innerText.replace(/\\s+/g, ' ').trim() ?? null
  })
})()`

try {
  await drive.ready()
  await drive.resize(1300, 900)
  await sleep(3000)
  // A copy the ledger cannot read is counted, never listed: say so rather than find no rows.
  const history = JSON.parse(String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 30 && document.querySelectorAll('.lc-convrow').length === 0; i += 1) await new Promise((r) => setTimeout(r, 500))
    const answer = await window.desktop.getMissionHistory()
    return JSON.stringify(answer.ok ? { listed: answer.data.missions.length, unreadable: answer.data.unreadableCount } : { refused: true })
  })()`)))
  check('every copied mission is readable and listed', history.listed === MISSIONS.length && history.unreadable === 0, JSON.stringify(history))
  for (let at = 0; at < MISSIONS.length; at += 1) {
    const opened = String(await drive.evaluate(`(async () => {
      const rows = [...document.querySelectorAll('.lc-convrow')]
      const row = rows[${String(at)}]
      if (!row) return 'no row ${String(at)} of ' + rows.length
      ;(row.querySelector('.lc-conv') ?? row).click()
      await new Promise((r) => setTimeout(r, 1800))
      let box = document.querySelector('.lc-thread')
      while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement
      box?.scrollTo(0, 0)
      await new Promise((r) => setTimeout(r, 400))
      return 'opened'
    })()`))
    if (opened !== 'opened') { check(`mission ${String(at + 1)} opens`, false, opened); continue }
    const read = JSON.parse(String(await drive.capture(`mission ${String(at + 1)}: the top of the turn`, () => drive.evaluate(READ))))
    say(`  ${MISSIONS[at].slice(0, 8)}: ${String(read.groups)} groups; foot: ${String(read.foot)}; files: ${String(read.files).slice(0, 80)}`)
    for (const line of read.order.slice(0, 14)) say(`      ${line.slice(0, 120)}`)
    check(`mission ${String(at + 1)}: its steps are lines among what was said, not one bar`, read.groups > 0 && read.oldBar === 0, JSON.stringify({ groups: read.groups, oldBar: read.oldBar }))
    check(`mission ${String(at + 1)}: the finished turn has its foot`, read.foot !== null && read.foot.length > 0, String(read.foot))
    await drive.evaluate(`(async () => { document.querySelector('.lc-thread .lc-steps__line')?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
    await drive.capture(`mission ${String(at + 1)}: the first group opened`, () => drive.evaluate(`String(document.querySelector('.lc-thread .lc-steps__list')?.querySelectorAll('.lc-filerow').length ?? 0) + ' rows'`))
    await drive.evaluate(`(async () => { let box = document.querySelector('.lc-thread'); while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement; box?.scrollTo(0, box.scrollHeight); await new Promise((r) => setTimeout(r, 400)) })()`)
    await drive.capture(`mission ${String(at + 1)}: the end of the turn`, () => drive.evaluate(READ))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Real finished missions copied from this machine into a scratch profile, opened one by one. Sends nothing.`, extra: `Checks failed: ${String(failures)}` })
}
say(`record: ${OUT}`)
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
