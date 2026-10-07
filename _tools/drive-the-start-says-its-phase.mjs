// While a teammate starts, does the thread say the phase, and does the end record the timings (0.602)?
//
//   node _tools/drive-the-start-says-its-phase.mjs [--packaged <exe>] [--tag <name>]
//
// Wren on the free OpenCode model, Accept edits, asked for one word. From the
// moment Send is pressed the live line is read every 100 ms until the runtime's
// first event; the words it showed must include "Briefing" and "Starting
// OpenCode", in that order, and "Reading the folder" between them (a writing
// run looks at the tree). When the run ends, the saved record must carry the
// host's note: "Started in N s: ... OpenCode took N s to say it had started."
// Read from the record since 2026-10-07: Colin had it taken off the thread on
// 10/05 (keptForTheRecord, missionView.ts), so Details no longer shows it.
// Measured before 0.602 (the control on an older package): the line reads
// "Starting" for the whole wait, and no such note exists.
//
// Nothing is spent.

import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `the-start-says-its-phase-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-start-phase-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-start-phase-profile-'))
const drive = await startDrive({
  name: `the-start-says-its-phase-${tag}`, port: 9796, workspace, profilePath, outPath: OUT, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const running = async () => String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'true'
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  // Send, then sample the live line every 100 ms inside the page, so nothing between the drive and the window skews the timing.
  const seen = JSON.parse(String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word DONE and nothing else. Do not read or change any file.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    let sent = false
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); sent = true; break }
    }
    if (!sent) return JSON.stringify({ sent: false, labels: [] })
    const t0 = performance.now()
    const labels = []
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 100))
      const label = document.querySelector('.lc-livestep__label')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      if (label.length > 0 && labels.at(-1)?.text !== label) labels.push({ text: label, atMs: Math.round(performance.now() - t0) })
      // The start is over once the line stops saying a starting phase, or the run has ended.
      const starting = /^(Starting|Looking for|Briefing|Reading the folder)/.test(label)
      const live = document.querySelector('button[aria-label^="Stop the running"]') !== null
      if ((label.length > 0 && !starting) || (!live && i > 20)) break
    }
    return JSON.stringify({ sent: true, labels })
  })()`)))
  check('the task was sent', seen.sent === true)
  const texts = seen.labels.map((entry) => entry.text)
  say(`  live line while starting: ${JSON.stringify(seen.labels)}`)
  const at = (word) => texts.findIndex((text) => text.includes(word))
  // The runtime's own start is the long part of the wait (seconds); the line must have named it.
  check('the line said Starting OpenCode while the runtime started', at('Starting OpenCode') >= 0, JSON.stringify(texts))
  const bare = seen.labels.filter((entry) => /^Starting\b(?!\s*OpenCode)/.test(entry.text))
  const bareFor = bare.length === 0 ? 0 : (seen.labels[seen.labels.indexOf(bare[0]) + 1]?.atMs ?? Infinity) - bare[0].atMs
  check('the bare word Starting, if it showed at all, was replaced within half a second', bareFor <= 500, `${JSON.stringify(texts)} bare for ${String(bareFor)} ms`)
  for (let i = 0; i < 240 && (await running()); i += 1) await sleep(1000)
  check('the run ended', !(await running()))
  // Written just after the run's end: given a moment, then read from the saved record.
  let note = 'no start-timing note in the saved record'
  for (let i = 0; i < 20 && note.startsWith('no '); i += 1) {
    await sleep(500)
    const ledger = join(profilePath, 'mission-ledger')
    for (const file of (await readdir(ledger).catch(() => [])).filter((name) => name.endsWith('.jsonl'))) {
      for (const line of (await readFile(join(ledger, file), 'utf8').catch(() => '')).split('\n').filter(Boolean)) {
        const payload = JSON.parse(line).event?.payload
        if (payload?.code === 'host.start-timing' && typeof payload.message === 'string') note = payload.message
      }
    }
  }
  await drive.capture('the record of the start, from the saved record', () => JSON.stringify(note))
  check("the saved record carries the host's note on where the start's seconds went", /^Started in \d+\.\d s: looked for OpenCode \d+\.\d s, briefed \d+\.\d s, read the folder \d+\.\d s; OpenCode took \d+\.\d s to say it had started\.$/.test(note), note)
  // A phase that lasted under 0.3 s is allowed to go unseen (the line is sampled every 100 ms); one that
  // lasted longer must have been on the line. The note says how long each took.
  const secondsOf = (word) => Number(new RegExp(`${word} (\\d+\\.\\d) s`).exec(note)?.[1] ?? '0')
  for (const [word, label] of [['briefed', 'Briefing'], ['read the folder', 'Reading the folder']]) {
    const took = secondsOf(word)
    if (took >= 0.3) check(`the line said ${label}, which took ${String(took)} s`, at(label) >= 0, JSON.stringify(texts))
    else say(`  (${label} took ${String(took)} s; too brief to be sampled, not checked on the line)`)
  }
  say(failures === 0 ? '\nTHE START SAYS ITS PHASE PASSED' : `\nTHE START SAYS ITS PHASE: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free OpenCode model, Accept edits, asked for one word; the live line sampled every 100 ms from Send until the first event, then the start's note under Details.`, extra: `Checks failed: ${String(failures)}` })
  process.exitCode = failures === 0 ? 0 : 1
}
