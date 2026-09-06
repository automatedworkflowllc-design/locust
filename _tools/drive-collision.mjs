// Two teammates told to change the SAME file at the same moment.
//
//   node _tools/drive-collision.mjs
//
// The concurrency drive proved three teammates can work at once, each in its
// own thread, and fixed the receipt that credited each with the others' files
// (2026-09-06). It deliberately left the harder case alone: two runs editing
// ONE file. Nothing in the app arbitrates that -- the folder is shared on
// purpose -- so the question is not whether Locust prevents it. It is what a
// person is left holding afterwards, and whether the app's account of it is
// true.
//
// Both teammates are asked to APPEND a line and change nothing else, which is
// the friendliest possible version of the collision: the two edits do not
// conflict in meaning, only in timing. A model that reads, appends and writes
// will drop the other's line if the other wrote in between.
//
// What is measured, off the disk rather than off the screen:
//   - do both lines survive, or does one silently vanish
//   - do the ten original lines survive
//   - what each teammate's own receipt claims about it
//
// There is no pass mark here. Silent loss is a finding; both lines surviving
// is a finding about timing, not a guarantee. The record says which happened.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const MARKS = { Wren: 'WREN-WAS-HERE', Gem: 'GEM-WAS-HERE' }
const SHARED = 'shared.md'

const workspace = await scratchRepository('locust-drive-collision-ws-')
// Ten numbered lines, so anything the runs destroy is obvious and countable.
const original = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`).join('\n')
await writeFile(join(workspace, SHARED), `${original}\n`, 'utf8')

const drive = await startDrive({
  name: 'collision',
  port: 9315,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', createdAt: '2026-09-05T05:00:01.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Open a teammate, put them on the free model, and send without waiting. */
const startFor = async (name) => {
  await drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message ${name}').click()
    await new Promise(r => setTimeout(r, 350))
  })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Append one new line reading ${MARKS[name]} to the end of ${SHARED}. Do not change any existing line. Then reply with exactly the word DONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    await new Promise(r => setTimeout(r, 300))
    return 'sent to ${name}'
  })()`)
}

/** What one teammate's finished card claims it did. */
const traceFor = (name) => drive.evaluate(`(async () => {
  const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + ${JSON.stringify(name)}).test(r.innerText.trim()))
  row?.querySelector('.lc-teammate__mission')?.click()
  await new Promise(r => setTimeout(r, 1100))
  const fold = [...document.querySelectorAll('.lc-activity, .lc-fold, .lc-row')]
    .map(n => n.innerText.split(String.fromCharCode(10))[0])
    .find(t => /tool call/.test(t))
  return ${JSON.stringify(name)} + ': ' + (fold ?? 'no activity line found')
})()`)

try {
  await drive.ready()
  const rostered = await drive.evaluate(`document.querySelectorAll('.lc-teammate').length`)
  // A seeded record that does not parse is DROPPED in silence by design, and
  // a drive measuring one teammate while believing it has two is worse than
  // no drive at all.
  if (Number(rostered) !== 2) throw new Error(`roster holds ${String(rostered)} teammates, not 2`)

  await drive.capture('two teammates, one file, ten known lines', () => `roster: ${String(rostered)} · ${SHARED} seeded with 10 lines`)

  await drive.capture('both told to append to the same file, neither waiting', async () => {
    const said = []
    for (const name of Object.keys(MARKS)) said.push(await startFor(name))
    return said.join(' || ')
  })

  await drive.capture('wait for both to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 400))
      const rows = [...document.querySelectorAll('.lc-teammate')]
      if (rows.every(r => /idle/.test(r.innerText))) return 'both settled after ' + String(i * 0.4) + 's'
    }
    return 'still going'
  })()`))

  await drive.capture('what is actually on disk now', async () => {
    const text = await readFile(join(workspace, SHARED), 'utf8')
    const lines = text.split('\n').filter((line) => line.length > 0)
    const kept = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`).filter((line) => lines.includes(line))
    const marks = Object.entries(MARKS).map(([who, mark]) => `${who}'s line ${lines.some((line) => line.includes(mark)) ? 'survived' : 'IS GONE'}`)
    return `${marks.join(' · ')} · ${String(kept.length)}/10 original lines intact · ${String(lines.length)} lines total`
  })

  await drive.capture('what each teammate says it did', async () => {
    const said = []
    for (const name of Object.keys(MARKS)) said.push(await traceFor(name))
    return said.join(' || ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: whatever \`pnpm build\` last wrote to out/. Wren and Gem on the free OpenCode model, both asked to append a different line to ${SHARED} at the same moment.`
  })
}
