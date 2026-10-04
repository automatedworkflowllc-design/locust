// Four teammates, one file, all appending at once.
//
//   node _tools/drive-conflicting-writes.mjs
//
// The build log's own Open-honestly block has said this for two days:
// "nothing here arbitrates two runs on one file, and a model that reads a
// file, appends and writes the whole thing back will drop the other's line
// whenever the other writes in between." Two teammates were tried once, both
// lines survived, and that was correctly recorded as a result about timing
// rather than a guarantee. Four have never been tried.
//
// Losing a line is NOT the defect this looks for. It is expected, it is
// inherent to read-modify-write against a shared file, and Locust does not
// claim otherwise. **The defect would be a card that claims a line landed
// when it did not** -- a receipt for work the disk never received. That is
// the same class as the diff counter and the "no files changed" claim, and it
// is the one thing the app must never get wrong.
//
// So the disk is read last and compared against what each of the four says
// about itself. Four short turns on the free OpenCode model.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const TARGET = 'ledger.txt'
/** One word each, so a lost line is identifiable rather than merely a count. */
const TEAM = [
  { id: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', word: 'ALMANAC' },
  { id: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', word: 'BRAMBLE' },
  { id: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', word: 'CINDER' },
  { id: 'tm_juno', name: 'Juno', hue: 'blue', role: 'Data & Reporting', word: 'DRIFTWOOD' }
]

const SEEDED = Array.from({ length: 10 }, (_, i) => `line ${String(i + 1)}`)

const workspace = await scratchRepository('locust-conflict-ws-')
const { writeFile } = await import('node:fs/promises')
await writeFile(join(workspace, TARGET), `${SEEDED.join('\n')}\n`, 'utf8')

const drive = await startDrive({
  name: 'conflicting-writes',
  port: 9360,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: TEAM.map((t, i) => ({
      teammateId: t.id,
      name: t.name,
      hue: t.hue,
      role: t.role,
      createdAt: `2026-09-05T05:00:0${String(i)}.000Z`
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const startFor = async ({ name, word }) => {
  await drive.evaluate(`(async () => {
    ${teammateFace(name)}.click()
    await new Promise(r => setTimeout(r, 350))
  })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  // Sent WITHOUT waiting -- four at once is the whole point.
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Append the single line ${word} to the very end of ${TARGET}. Keep every existing line exactly as it is. Change no other file. Then reply with exactly the word ${word}.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    await new Promise(r => setTimeout(r, 300))
    return '${name}'
  })()`)
}

try {
  await drive.ready()
  const rostered = Number(await drive.evaluate(`document.querySelectorAll('.lc-faces__one').length`))
  if (rostered !== TEAM.length) {
    throw new Error(`roster holds ${String(rostered)} teammates, not ${String(TEAM.length)} -- a seeded record did not parse`)
  }

  await drive.capture('four teammates, all aimed at one file', async () => {
    const sent = []
    for (const member of TEAM) sent.push(await startFor(member))
    return `started without waiting: ${sent.join(', ')}`
  })

  await drive.capture('how many ran at once', () => drive.evaluate(`(async () => {
    let peak = 0
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 400))
      const rows = ${teammateRows()}
      const working = rows.filter(r => !/idle/.test(r.innerText)).length
      if (working > peak) peak = working
      if (peak > 0 && working === 0) break
    }
    return 'peak working at once: ' + String(peak) + ' of ${String(TEAM.length)}'
  })()`))

  await drive.capture('all settled', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const rows = ${teammateRows()}.map(r => r.innerText)
      if (rows.every(r => /idle|done/.test(r))) return 'all settled after ' + String(i / 2) + 's'
    }
    return 'STILL GOING'
  })()`))

  // What each of the four says about its own work.
  await drive.capture('what each card claims', () => drive.evaluate(`(async () => {
    const team = ${JSON.stringify(TEAM.map(({ name, word }) => ({ name, word })))}
    const out = []
    for (const member of team) {
      const row = ${teammateRows()}.find(r => new RegExp('^' + member.name).test(r.innerText.trim()))
      row?.conversation?.click()
      await new Promise(r => setTimeout(r, 1100))
      const fold = document.querySelector('.lc-activity')
      const trace = fold ? fold.innerText.split(String.fromCharCode(10)).map(t => t.trim()).filter(Boolean).join(' ') : 'no fold'
      out.push(member.name + ' [' + trace.slice(0, 70) + ']')
    }
    return out.join('  ||  ')
  })()`))

  // The disk decides. Everything above is a claim; this is the fact.
  await drive.capture('what the file on disk actually holds', async () => {
    const body = await readFile(join(workspace, TARGET), 'utf8').catch(() => undefined)
    if (body === undefined) return `${TARGET} is GONE`
    const lines = body.split('\n').filter((l) => l.trim().length > 0)
    const landed = TEAM.filter((t) => lines.includes(t.word)).map((t) => t.word)
    const lost = TEAM.filter((t) => !lines.includes(t.word)).map((t) => t.word)
    const seededIntact = SEEDED.every((l) => lines.includes(l))
    return `words landed: ${landed.length}/${String(TEAM.length)} (${landed.join(',') || 'none'})`
      + ` || LOST: ${lost.join(',') || 'none'}`
      + ` || the 10 seeded lines intact: ${seededIntact ? 'yes' : 'NO — existing work was destroyed'}`
      + ` || total lines: ${String(lines.length)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Four teammates appending to one file at once, and whether the receipts are honest.' })
}
