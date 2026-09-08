// A team working together for a long stretch, the way the app is meant to be used.
//
//   node _tools/drive-team-day.mjs
//
// Every "long" drive in this repo so far is short. `drive-long-session` sends
// fifteen turns of "reply with the word ACK1" and finishes in a couple of
// minutes; `drive-long-working-session` sends twelve one-line file edits.
// Neither is a day's work, and neither has more than one teammate in it.
//
// This is the app's actual premise: several teammates, in one folder, over a
// long stretch, each doing real work and talking to each other. It has been
// driven ONCE, with three teammates and one turn each (0.36.3, which found the
// activity card counting everyone's files as everyone's).
//
// Three teammates, eight rounds each, real edits, peer messages between them,
// on free models. Expect this to run for a long time and to be left alone
// while it does.
//
// What it watches for, none of which a short drive can see:
//   - work attributed to the wrong teammate as the folder fills up
//   - a thread that grows without bound once several teammates share it
//   - peer messages lost when the recipient is mid-run (the G1-G5 family)
//   - renderer errors that only appear after long uptime
//   - the ledger, the heap and the DOM over tens of turns rather than ten

import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const ROUNDS = 8
const TEAM = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations' },
  // Hues and roles the roster actually knows. `sky`, `amber` and
  // `Tests & Review` are none of them, and seeding those dropped two of three
  // teammates without a word -- which is the defect this drive then went on to
  // find in drive-lib's own seed check.
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs' },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA' }
]

const workspace = await scratchRepository('locust-drive-teamday-ws-')
const drive = await startDrive({
  name: 'team-day',
  port: 9405,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: TEAM.map((member) => ({ ...member, createdAt: '2026-09-05T05:00:00.000Z' })),
    missionOwners: {},
    // Relay ON: teammates talking to each other is the half that has never
    // been driven for long.
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const reading = `(() => {
  const memory = performance.memory
  const scroller = [...document.querySelectorAll('*')]
    .filter((el) => el.scrollHeight > el.clientHeight + 40)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  return {
    heapMb: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1048576),
    nodes: document.getElementsByTagName('*').length,
    folds: document.querySelectorAll('.lc-activity').length,
    fileRows: document.querySelectorAll('.lc-filerow').length,
    screens: scroller === undefined ? null : Math.round((scroller.scrollHeight / Math.max(1, scroller.clientHeight)) * 10) / 10,
    // Anything the app itself is complaining about.
    notices: [...document.querySelectorAll('.lc-notice, .lc-diagnostic')].map((n) => n.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 90))
  }
})()`

/** Address a teammate by name, then send and wait. */
const turn = (who, text) => `(async () => {
  const chip = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ' + ${JSON.stringify(who)}))
  if (!chip) return 'no teammate chip for ' + ${JSON.stringify(who)}
  chip.click()
  await new Promise(r => setTimeout(r, 700))
  const box = document.querySelector('textarea[aria-label="Mission instruction"]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 250))
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 1000))
    if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'done in ' + i + 's'
  }
  return 'still running after four minutes'
})()`

const ledgerBytes = async () => {
  try {
    const root = join(drive.profile, 'mission-ledger')
    const names = await readdir(root)
    let total = 0
    for (const name of names) {
      const info = await stat(join(root, name)).catch(() => undefined)
      if (info?.isFile() === true) total += info.size
    }
    return total
  } catch {
    return 0
  }
}

const trend = []

try {
  await drive.capture('launch, three teammates on free models', async () => {
    await drive.ready()
    // Each teammate gets the free route, chosen once through their own picker.
    for (const member of TEAM) {
      await drive.evaluate(`(async () => {
        [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ' + ${JSON.stringify(member.name)}))?.click()
        await new Promise(r => setTimeout(r, 600))
      })()`)
      await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
    }
    return `${String(TEAM.length)} teammates ready`
  })

  for (let round = 1; round <= ROUNDS; round += 1) {
    for (const member of TEAM) {
      const isLast = member.name === 'Juno'
      // Juno reviews and tells Wren what it found, which exercises the peer
      // path under load rather than in isolation.
      const text = isLast
        ? `Read the file ${member.name.toLowerCase()}-${String(round)}.txt if it exists, then write review-${String(round)}.txt containing one line: reviewed round ${String(round)}. Then tell Wren what you wrote, using the share block.`
        : `Create ${member.name.toLowerCase()}-${String(round)}.txt containing exactly the line: ${member.name} round ${String(round)}. Use your file tools. Say DONE.`
      const outcome = await drive.evaluate(turn(member.name, text))
      const seen = JSON.parse(await drive.evaluate(`JSON.stringify(${reading})`))
      trend.push({ round, who: member.name, outcome: String(outcome), ...seen, ledger: await ledgerBytes() })
    }
    if (round === 1 || round === Math.ceil(ROUNDS / 2) || round === ROUNDS) {
      const latest = trend[trend.length - 1]
      await drive.capture(`after round ${String(round)} of ${String(ROUNDS)}`, () =>
        `heap ${String(latest.heapMb)}MB · ${String(latest.nodes)} nodes · ${String(latest.folds)} folds · ${String(latest.screens)} screens · ledger ${String(Math.round(latest.ledger / 1024))}KB · notices: ${JSON.stringify(latest.notices)}`)
    }
  }

  await drive.capture('did every teammate keep their own work', () => drive.evaluate(`(async () => {
    // The 0.36.3 defect was every card counting everyone's files. With three
    // teammates writing into one folder for eight rounds, that would be loud.
    const rows = [...document.querySelectorAll('.lc-filerow__path')].map(n => n.textContent?.trim() ?? '')
    return JSON.stringify({ pathsOnScreen: rows.slice(0, 12), total: rows.length }, null, 1)
  })()`))

  await drive.capture('what the app is complaining about, if anything', () => drive.evaluate(`(() => {
    const text = document.body.innerText
    return JSON.stringify({
      lostMessages: /could not be delivered|not on the roster|nothing was sent/i.test(text),
      queueTrouble: /more output than Locust could take in|oversized/i.test(text),
      persistence: /durable local ledger/i.test(text),
      anyNotice: [...document.querySelectorAll('.lc-notice, .lc-diagnostic')].map(n => n.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 120))
    }, null, 1)
  })()`))

  await drive.capture('the trend across the whole session', () => {
    const first = trend[0]
    const last = trend[trend.length - 1]
    return `${String(trend.length)} turns || heap ${String(first.heapMb)} -> ${String(last.heapMb)}MB || nodes ${String(first.nodes)} -> ${String(last.nodes)} || ledger ${String(Math.round(first.ledger / 1024))} -> ${String(Math.round(last.ledger / 1024))}KB || screens ${String(first.screens)} -> ${String(last.screens)}`
  })

  /*
   * The per-turn measurements go to a FILE, not into the step table.
   *
   * `finish()` truncates each note at 220 characters for the table's sake, so
   * pushing twenty-four turns of readings in as one note kept the first two
   * and silently dropped the rest -- the whole point of a long run, lost to a
   * column width. Read `trend.json` beside the screenshots instead.
   */
  await writeFile(join(drive.out, 'trend.json'), JSON.stringify(trend, null, 1), 'utf8')
  const completed = trend.filter((entry) => entry.outcome.startsWith('done in')).length
  drive.record.push({
    step: drive.record.length + 1,
    title: 'every turn',
    note: `${String(completed)} of ${String(trend.length)} turns completed; full readings in trend.json`,
    errors: []
  })
} finally {
  await drive.finish({
    intro: 'Three teammates, eight rounds each, real file work and peer messages, on free models. The long multi-teammate session the app is built for and has never had.'
  })
}

say('done')
