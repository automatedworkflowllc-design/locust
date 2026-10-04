// Does a reply streamed in a thousand pieces still read whole after a reload?
//
//   node _tools/probe-a-long-reply-survives-reload.mjs
//
// Colin, 2026-09-11, with a screenshot: "looks like this message got cut off".
// The reply began `195-205B** (from $180-190B)` -- an unopened bold, a
// sentence with no front. MEASURED on his own ledger (mission 645f02a4,
// Cursor, 1279 events of which 1251 were fragments of that one reply): the
// file on disk held 4853 characters and the renderer was handed 1954. Sixty
// percent of an answer about a stock, gone, with nothing on screen to say so.
//
// The cause was the history window. It bounds the event COUNT, and a reply is
// not an event -- it is hundreds of `message.delta` fragments the renderer
// concatenates. Keeping the newest 499 kept the END of the reply.
//
// This probe reads HIS ledger, copied into a scratch profile, and asks the
// built app to show that mission. It SPENDS NOTHING: no run is started, the
// app only reads a record that already exists.
//
// The assertion is the first sentence the model actually wrote. A length or a
// "not empty" check would have passed every day this was broken.

import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { say, startDrive } from './drive-lib.mjs'

const HIS = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
// Either of Colin's real conversations: the one whose FRONT was lost to the
// history window (the default), or one the old Cursor adapter recorded
// doubled, which the reader repairs on load. `LOCUST_LEDGER` and
// `LOCUST_ROW` pick the other one.
const LEDGER = process.env.LOCUST_LEDGER ?? 'mission_645f02a4-40b4-4b9e-9c71-bd29c451da7c.jsonl'
const WANTED = process.env.LOCUST_ROW ?? 'google as a stock'

const profile = await mkdtemp(join(tmpdir(), 'locust-long-reply-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
await cp(join(HIS, 'mission-ledger', LEDGER), join(profile, 'mission-ledger', LEDGER))
for (const file of ['teammates.json', 'workspace.json', 'rooms.json']) {
  await cp(join(HIS, file), join(profile, file)).catch(() => undefined)
}

// What the ledger holds, read here rather than assumed, so the screen is
// compared against the record instead of against a string in this file.
const lines = (await readFile(join(profile, 'mission-ledger', LEDGER), 'utf8')).split(/\r?\n/).filter(Boolean)
const whole = lines
  .map((line) => JSON.parse(line))
  .filter((record) => record.recordType === 'mission.event' && record.event.type === 'message.delta')
  .reduce((text, record) => (record.event.payload.operation === 'replace' ? '' : text) + record.event.payload.text, '')
say(`the ledger holds ${String(whole.length)} characters across ${String(lines.length)} records`)

const drive = await startDrive({
  name: 'a-long-reply-survives-reload',
  port: 9506,
  workspace: process.cwd(),
  profilePath: profile
})

// No backticks inside these template literals.
const open = `(async () => {
  const missions = [...document.querySelectorAll('button, a')].find(n => /^(Conversations|Missions)$/.test(n.innerText.trim()))
  if (missions === undefined) return 'no Missions button'
  missions.click()
  await new Promise(r => setTimeout(r, 1200))
  const row = [...document.querySelectorAll('.lc-missionrow, .lc-row')].find(n => new RegExp(${JSON.stringify(WANTED)}, 'i').test(n.innerText))
  if (row === undefined) return 'no row for that mission'
  row.click()
  await new Promise(r => setTimeout(r, 2000))
  return 'opened'
})()`

const read = `(async () => {
  const bubbles = [...document.querySelectorAll('.lc-agentline__body')]
  const texts = bubbles.map(n => n.innerText)
  const longest = texts.slice().sort((a, b) => b.length - a.length)[0] ?? ''
  return JSON.stringify({
    bubbles: bubbles.length,
    shownLength: longest.length,
    head: longest.slice(0, 120),
    // The question, asked of the screen: is the FRONT of the reply there?
    startsWhereTheModelStarted: /^I.ll pull current Alphabet numbers/.test(longest),
    // The break Colin photographed, named so a regression is known on sight:
    // a bold that closes without ever opening, because its front is gone.
    closesABoldItNeverOpened: longest.split('**').length === 2
  }, null, 1)
})()`

try {
  await drive.capture('his own mission, reopened from the ledger', async () => {
    await drive.ready()
    return drive.evaluate(open)
  })
  const seen = await drive.capture('the reply still starts where the model started', () => drive.evaluate(read))
  const measured = JSON.parse(seen)
  say(`ledger ${String(whole.length)} characters, screen ${String(measured.shownLength)}`)
  if (!measured.startsWhereTheModelStarted) say('STILL CUT OFF: the reply does not begin where the ledger does')
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: "Colin's own ledger for mission 645f02a4, copied into a scratch profile and reopened. 1251 of its 1279 events are fragments of one reply; the history window used to keep the newest 499 and drop the front of it."
  })
}
