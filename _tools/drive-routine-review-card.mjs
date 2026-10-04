// A routine waiting for review, on the Routines screen (0.391).
//
//   node _tools/drive-routine-review-card.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-27, a screenshot from testing: the card read as five columns
// a few words wide -- "Waiting / for / your / review" -- and the review box
// and both decisions were not on screen at all. The card wore the row's meta
// class, which the Routines screen lays out as one clipped flex line in one
// grid cell. Seeded, not run: the card is drawn from the saved receipt alone,
// and the receipt here is the one in his screenshot (step 2 of 2, the run
// interrupted). Spends nothing.

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('routine-review-card-2026-09-27'), `routine-review-card-${tag}`)
await mkdir(OUT, { recursive: true })

const route = { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'accept-edits' }
const steps = ['Read README.md and report the project name.', 'Summarise it in one line.']
const routines = {
  schemaVersion: 1,
  routines: [{
    routineId: 'rt_readme',
    name: 'Read README.md and report the project name',
    teammateId: 'tm_pip',
    route,
    steps,
    learnedFrom: [],
    createdAt: '2026-09-27T06:00:00.000Z',
    runs: 0,
    schedule: { kind: 'every', hours: 6 },
    execution: {
      attemptId: 'attempt_readme',
      status: 'held',
      step: 2,
      of: 2,
      workspaceId: 'ws_scratch',
      startedAt: '2026-09-27T06:13:54.000Z',
      updatedAt: '2026-09-27T06:14:30.000Z',
      steps,
      route,
      missionId: 'mission_bc5e76ad-fe34-4489-a4e8-c26eb1eba22f',
      runId: 'run_bc5e76ad',
      reason: 'Review required: that run was interrupted. Nothing will be replayed.',
      canContinue: false
    }
  }]
}

const workspace = await scratchRepository('locust-routine-review-ws-')
const drive = await startDrive({
  name: `routine-review-card-${tag}`,
  port: 9693,
  workspace,
  outPath: OUT,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  files: { 'routines.json': routines },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_pip', name: 'Pip', hue: 'lime', role: 'Ops & Scheduling', createdAt: '2026-09-27T05:00:00.000Z', route }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Every part of the card: where it is, and whether a pointer at its centre lands on it. */
const measure = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
  const card = document.querySelector('.lc-automations .lc-recovery')
  if (!card) return { card: null }
  const row = card.closest('.lc-routinerow')
  const box = (node) => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const reachable = (node) => {
    const r = node.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const hit = document.elementFromPoint(r.x + Math.min(r.width / 2, 20), r.y + r.height / 2)
    return hit !== null && (hit === node || node.contains(hit))
  }
  const parts = [...card.children].map((node) => ({ tag: node.tagName.toLowerCase(), text: node.innerText.replace(/\\s+/g, ' ').slice(0, 60), box: box(node), reachable: reachable(node) }))
  const controls = [...card.querySelectorAll('button, input, summary')].map((node) => ({ text: (node.innerText || node.getAttribute('type') || '').trim().slice(0, 40), box: box(node), reachable: reachable(node) }))
  return { card: box(card), row: box(row), parts, controls, text: card.innerText.replace(/\\s+/g, ' ') }
})())`)))

try {
  await drive.ready()
  for (const [width, height] of [[1440, 900], [1000, 800]]) {
    await drive.resize(width, height)
    await drive.capture(`the Routines screen at ${String(width)}px`, async () => {
      await drive.evaluate(`document.querySelector('button[title="Routines — work that repeats"]')?.click()`)
      await sleep(1200)
      return JSON.stringify((await measure()).parts?.map((part) => `${part.tag} ${String(part.box.w)}x${String(part.box.h)}`))
    })
    const seen = await measure()
    check(`${String(width)}px: the card is there`, seen.card !== null)
    if (seen.card === null) continue
    check(`${String(width)}px: it spans the row from the name on`, seen.card.w >= seen.row.w * 0.7, `card ${String(seen.card.w)} of row ${String(seen.row.w)}`)
    const lines = seen.parts.filter((part) => part.tag === 'span' || part.tag === 'label')
    check(`${String(width)}px: no line is crushed into a column`, lines.every((part) => part.box.w >= 240), lines.map((part) => `${String(part.box.w)}px "${part.text}"`).join(' | '))
    check(`${String(width)}px: every control can be reached`, seen.controls.length >= 5 && seen.controls.every((control) => control.reachable), seen.controls.map((control) => `${control.text}:${String(control.reachable)}`).join(' | '))
    // The host re-words a receipt from another folder ("Open the original
    // workspace..."), so the words are pinned by routine-recovery.test.tsx
    // and this asks only that review is not said twice.
    check(`${String(width)}px: "review" is said once`, !seen.text.includes('Review required:'), seen.text.slice(0, 160))
    const open = seen.controls.find((control) => control.text === 'Open the saved conversation')
    check(`${String(width)}px: "Open the saved conversation" sits with its lines, not across the card`, open !== undefined && open.box.x - seen.card.x < 40, open === undefined ? 'missing' : `${String(open.box.x - seen.card.x)}px in`)
    check(`${String(width)}px: no raw mission id on the card`, !seen.text.includes('mission_bc5e76ad'))
  }
  // 0.392, from the 0.390 beta pass: the LAST step offers no Continue, says
  // why, and Keep puts the attempt down with the schedule left in place.
  check('the last step says there is nothing left to continue', String(await drive.evaluate(`document.querySelector('.lc-automations .lc-recovery')?.innerText ?? ''`)).includes('This was the last step, so there is nothing left to continue.'))
  await drive.capture('ticking the review box: Keep the schedule and Abandon ready, no Continue', async () => {
    await drive.evaluate(`document.querySelector('.lc-automations .lc-recovery input[type="checkbox"]')?.click()`)
    await sleep(400)
    return drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-automations .lc-recovery__actions button')].map((b) => b.innerText + ':' + (b.disabled ? 'held' : 'ready')))`)
  })
  const buttons = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-automations .lc-recovery__actions button')].map((b) => b.innerText + ':' + (b.disabled ? 'held' : 'ready')))`)))
  const keepLine = String(await drive.evaluate(`document.querySelector('.lc-automations .lc-recovery')?.innerText ?? ''`))
  check('before the click, the card says when Keep runs it next, and not straight away', /its next run starts from step 1 at .+, not straight away/.test(keepLine), (keepLine.match(/Keep clears[^.]*\./) ?? ['(no Keep line)'])[0])
  check('after the box: Keep the schedule ready, Abandon ready, no Continue', JSON.stringify(buttons) === JSON.stringify(['Keep the schedule:ready', 'Abandon attempt and remove schedule:ready']), JSON.stringify(buttons))
  await drive.capture('Keep the schedule: the card goes, the routine stays scheduled', async () => {
    await drive.evaluate(`[...document.querySelectorAll('.lc-automations .lc-recovery__actions button')].find((b) => b.innerText === 'Keep the schedule')?.click()`)
    await sleep(1500)
    return drive.evaluate(`document.querySelector('.lc-automations')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? ''`)
  })
  const after = String(await drive.evaluate(`JSON.stringify({ card: document.querySelector('.lc-automations .lc-recovery') !== null, text: document.querySelector('.lc-automations .lc-routinerow')?.innerText.replace(/\\s+/g, ' ') ?? '' })`))
  const kept = JSON.parse(after)
  check('kept: no review card, still every 6 hours, not run now', !kept.card && /every 6 hours/.test(kept.text) && !/held for review/.test(kept.text), kept.text)
  /*
   * 0.404, from the 0.402 beta retest: this attempt started at 06:13 and the
   * routine runs every 6 hours, so by the time this drive runs it is OVERDUE.
   * Kept, its clock used to restart at the attempt's start -- due at once --
   * and the scheduler's next tick (every 60s) started step 1. Wait past one.
   */
  await sleep(80_000)
  const disk = JSON.parse(await readFile(join(drive.profile, 'routines.json'), 'utf8')).routines.find((entry) => entry.routineId === 'rt_readme')
  const later = String(await drive.evaluate(`document.querySelector('.lc-automations .lc-routinerow')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  check('a tick after Keep: nothing started, and the row does not say due now', disk.execution === undefined && disk.runs === 0 && !/due now|running/i.test(later), `${JSON.stringify({ execution: disk.execution?.status, runs: disk.runs, lastRunAt: disk.lastRunAt })} | ${later.slice(0, 160)}`)
  await drive.capture('a minute after Keep: still waiting for its next time', () => later)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A routine held for review at step 2 of 2, seeded from the receipt in Colin's screenshot.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
