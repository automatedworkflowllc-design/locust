// Killed at several different moments, not one.
//
//   node _tools/drive-crash-points.mjs
//
// `drive-interrupted` force-quits Electron mid-run and reopens it, which is
// the right shape and the only crash test here. It kills at ONE moment, after
// a fixed wait, so it exercises one phase of a run and calls it covered.
//
// The phases that differ are the ones with a write in flight: before the
// first event is persisted, part-way through a stream of them, and just as
// the closing receipt lands. A kill during an append is also the only way to
// test the ledger's crash-consistency claim for real -- it says an
// unparseable line and its tail are dropped with an issue raised, and that
// has been read in the source but never produced.
//
// So: the same run, killed at several delays, each time relaunched on the same
// profile. For each, three questions --
//   does the app come back at all
//   is the mission's state honest about what happened
//   does the ledger still parse, and if a line was torn, is it SAID
//
// Free OpenCode model, so the runs cost nothing.

import { readdir, readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

/*
 * Kill points, and the prompt they are matched to.
 *
 * A first run used [800, 3000, 8000, 15000] against "count 1 to 60" and the
 * results were worthless: the free model finished in under eight seconds, so
 * TWO of the four kills landed after the run was already complete, and the
 * other two landed before a single event had been persisted. The window this
 * drive exists for -- events being appended -- was missed entirely, and the
 * summary reported four clean recoveries as though it had covered it.
 *
 * So the work is now long enough that every point is inside it, and every
 * iteration asserts the run really WAS live when the kill landed. A crash
 * test whose kill arrives after the run is not a crash test, and it must say
 * so rather than pass.
 *
 * The second run then showed the assertion earning its keep: 1500, 4000 and
 * 9000 all landed inside a live run, and 16000 did not -- the free model had
 * already finished. A fixed delay cannot find the closing-receipt window,
 * because it depends on how long the model took. So the last point is not a
 * delay at all: it watches for the Stop control to disappear and kills within
 * milliseconds of that, which is the only way to be near the terminal receipt
 * on purpose rather than by luck.
 */
const KILL_AFTER_MS = [1500, 4000, 9000, 'at-finish']

const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

/** Every ledger file, and whether each one still reads as JSON lines. */
const ledgerHealth = async (profile) => {
  const root = join(profile, 'mission-ledger')
  const names = await readdir(root).catch(() => [])
  const files = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const text = await readFile(join(root, name), 'utf8').catch(() => '')
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    /*
     * The KINDS, not just the count. A first sweep reported "1 line" at every
     * live kill point and 58 after the run finished, and I could not tell
     * from that whether the ledger appends as the run goes or only flushes at
     * the end -- which is the whole persist-before-emit claim. A count cannot
     * answer it; the kinds can.
     */
    let torn = 0
    let terminal = ''
    const kinds = new Map()
    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        const kind = String(record?.recordType ?? 'no-recordType')
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
        // phaseFor() in mission-store derives a mission's phase from exactly
        // these three events and nothing else, so their presence is the whole
        // question: whether the screen's tag is a reading of the file or an
        // invention.
        const type = String(record?.event?.type ?? '')
        if (type === 'run.completed' || type === 'run.cancelled' || type === 'run.failed') terminal = type
      } catch {
        torn += 1
      }
    }
    const seen = [...kinds].map(([kind, count]) => `${kind}x${String(count)}`).join(' ')
    files.push({ name: name.slice(0, 16), lines: lines.length, torn, seen, terminal })
  }
  return files
}

const findings = []

for (const killAfter of KILL_AFTER_MS) {
  const workspace = await scratchRepository('locust-crash-ws-')
  const profile = await mkdtemp(join(tmpdir(), 'locust-crash-'))
  let drive = await startDrive({ name: 'crash-points', port: 9409, workspace, profilePath: profile, seed, keep: true })
  let handoff
  let wasLive = false

  try {
    await drive.capture(`killed ${String(killAfter)}ms in: start a run`, async () => {
      await drive.ready()
      await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
      await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
      await drive.evaluate(`(async () => {
        const box = document.querySelector('textarea[aria-label="Mission instruction"]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(box, 'Create ten files named crash-1.txt through crash-10.txt, each containing its own number. Use your file tools, one file at a time. Then say DONE.')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 200))
        box.focus()
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        return 'sent'
      })()`)
      const running = `document.querySelector('button[aria-label^="Stop the running"]') !== null`
      if (killAfter === 'at-finish') {
        // Wait for the run to go live, then kill the instant it stops being
        // live. This is the only point aimed at the closing receipt, and it
        // is deliberately a race -- the kill lands within about 50ms of the
        // transition, which is where a terminal write would be in flight.
        for (let waited = 0; waited < 20000; waited += 50) {
          if (String(await drive.evaluate(running)) === 'true') break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        for (let waited = 0; waited < 120000; waited += 50) {
          if (String(await drive.evaluate(running)) !== 'true') {
            wasLive = true
            return 'killing at the moment the run stopped reporting itself as running'
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return 'the run never finished within two minutes -- not a crash test'
      }
      await new Promise((resolve) => setTimeout(resolve, killAfter))
      // THE premise. If the run has already finished, this iteration is not a
      // crash test and must not be counted as one.
      wasLive = String(await drive.evaluate(running)) === 'true'
      return `killing now, ${String(killAfter)}ms after send; run was ${wasLive ? 'LIVE' : 'ALREADY FINISHED -- not a crash test'}`
    })
    handoff = await drive.finish({ intro: `Killed ${String(killAfter)}ms after the run started.`, last: false })
  } catch (error) {
    say(`first half failed at ${String(killAfter)}ms: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  const health = await ledgerHealth(profile)

  drive = await startDrive({
    name: 'crash-points',
    port: 9409,
    workspace,
    profilePath: profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  try {
    const seen = await drive.capture(`killed ${String(killAfter)}ms in: what it says on relaunch`, async () => {
      await drive.ready()
      return drive.evaluate(`(async () => {
        document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
        await new Promise(r => setTimeout(r, 1500))
        /*
         * The MISSION ROW's own tag, not any matching word on the page.
         *
         * Two wrong readings preceded this one. The first tested the whole
         * body text and matched the Missions screen's FILTER CHIPS -- Running,
         * Interrupted and Completed are labels on that row -- so every kill
         * point reported both interrupted and completed as true. The second
         * read a class I had invented, lc-receipt__state, which matches
         * nothing; it returned an empty string at every kill point, and an
         * empty string from a wrong selector is indistinguishable from an app
         * that says nothing. A screenshot from that same run showed the row
         * clearly tagged INTERRUPTED in red the whole time.
         *
         * So this reads lc-missionrow__tag, which is what Screens.tsx
         * actually renders, and the run asserts it is non-empty rather than
         * reporting whatever it found.
         *
         * No backticks in here: this comment sits inside a template literal
         * and one would end it. That has cost this session five times today.
         */
        const rows = document.querySelectorAll('.lc-missionrow')
        const tag = document.querySelector('.lc-missionrow__tag')?.textContent?.trim() ?? ''
        const stats = document.querySelector('.lc-missionrow__stats')?.textContent?.trim() ?? ''
        const heading = document.querySelector('h1, .lc-screen__title')?.parentElement?.innerText?.replace(/\\s+/g, ' ') ?? ''
        return JSON.stringify({
          tag,
          stats,
          heading: heading.slice(0, 90),
          missionsListed: rows.length,
          saysLedgerTrouble: /could not be read|invalid mission record|oversized/i.test(document.body.innerText)
        })
      })()`)
    })
    findings.push({ killAfter, wasLive, ledger: health, screen: String(seen) })
  } finally {
    await drive.finish({ intro: `Relaunched after the ${String(killAfter)}ms kill.` })
  }
}

say('')
say('=== every kill point ===')
for (const finding of findings) {
  const torn = finding.ledger.reduce((total, file) => total + file.torn, 0)
  const lines = finding.ledger.reduce((total, file) => total + file.lines, 0)
  const at = finding.killAfter === 'at-finish' ? 'at finish' : `${String(finding.killAfter)}ms`
  say(`${at}${finding.wasLive ? '' : '  (NOT A CRASH TEST -- run had finished)'}: ${String(finding.ledger.length)} ledger file(s), ${String(lines)} lines, ${String(torn)} torn`)
  const terminal = finding.ledger.map((file) => file.terminal).find((type) => type !== '') ?? ''
  for (const file of finding.ledger) say(`        ledger: ${file.seen}`)
  say(`        ${finding.screen}`)
  /*
   * The verdict, and what it is allowed to conclude.
   *
   * An earlier version failed any relaunch tagged COMPLETED, on the reasoning
   * that a killed run cannot have completed. That reasoning is wrong twice
   * over. The kill lands some hundreds of milliseconds after the liveness
   * check, so a run that was live at the check can legitimately finish in the
   * gap; and the at-finish point kills immediately AFTER the run stops being
   * live, where COMPLETED is the only correct answer. Both were reported as
   * failures of the app when they were failures of the harness.
   *
   * The file settles it. phaseFor() reads the tag off exactly one thing --
   * whether a terminal event is in the ledger -- so COMPLETED with the event
   * present is an honest reading, and COMPLETED without it would be the app
   * inventing an ending. That is the defect worth naming, and it is the only
   * one this drive can actually claim.
   */
  const parsed = JSON.parse(finding.screen)
  if (torn > 0) say(`        FAIL: ${String(torn)} torn ledger line(s) and the app did not say so`)
  if (parsed.missionsListed < 1) say('        FAIL: the mission did not survive the kill')
  else if (parsed.tag === '') say('        FAIL: the mission came back with no state tag at all')
  else if (/completed|failed|cancelled/i.test(parsed.tag) && terminal === '')
    say(`        FAIL: tagged ${parsed.tag} with no terminal event in the ledger`)
  else if (/interrupted/i.test(parsed.tag) && terminal !== '')
    say(`        FAIL: tagged INTERRUPTED although the ledger holds ${terminal}`)
  else say(`        ok: tagged ${parsed.tag}, ledger says ${terminal === '' ? 'no terminal event' : terminal}`)
}
say('done')
