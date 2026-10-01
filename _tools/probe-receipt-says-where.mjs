// Does a reopened mission say what it ran ON?
//
//   LOCUST_SPEND=1 node _tools/probe-receipt-says-where.mjs
//
// The design agent's ruling, 2026-09-11 (`RULING-2026-09-11-SCOPE-NOT-ABSENCE`):
// do not draw what a run could not have checked -- choosing which absences
// matter is a judgement about what the diff means, and without it the list is
// true of every run and becomes furniture. State SCOPE instead, positively,
// on the receipt, because the receipt already answers "under what conditions
// is this record true".
//
// What this measures: `Ran on Windows · <folder>` is on a reopened mission's
// receipt, and says nothing that reads as a warning.
//
// TWO LAUNCHES ON ONE PROFILE, and that is the point. The receipt draws for a
// mission RESTORED from the ledger; a run this session started is still a
// live run, so the first attempt at this probe reopened the mission from the
// Missions list, got the same live run back, and reported "no receipt" for a
// feature that was working. Reopening after a restart is also the path a
// person actually takes to a receipt.
//
// SPENDS one cheap Claude Code turn.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-receipt-ws-')
const now = '2026-09-05T05:00:00.000Z'
const SEED = {
  schemaVersion: 1,
  teammates: [
    {
      teammateId: 'tm_jim',
      name: 'Jimothy',
      hue: 'lime',
      role: 'Code & Migrations',
      createdAt: now,
      route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
    }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
}

const ASK = 'Reply with the single word: ok. Change no files and run no commands.'

// No backticks inside these template literals.
const send = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jimothy/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(ASK)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  const busy = () => [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|using|starting|writing/i.test(n.innerText))
  let quiet = 0
  for (let i = 0; i < 600; i += 1) {
    await new Promise(r => setTimeout(r, 400))
    quiet = busy() ? 0 : quiet + 1
    if (quiet >= 10) break
  }
  return 'ran'
})()`

/** After the restart: open the mission from the list and read its receipt. */
const readReceipt = `(async () => {
  const open = [...document.querySelectorAll('button, a')].find(n => /^(Conversations|Missions)$/.test(n.innerText.trim()))
  if (open === undefined) return 'no Missions button'
  open.click()
  await new Promise(r => setTimeout(r, 800))
  const row = document.querySelector('.lc-missionrow')
  if (row === null) return 'no mission row'
  row.click()
  await new Promise(r => setTimeout(r, 1500))
  const summary = document.querySelector('.lc-receipt__summary')
  if (summary === null) return 'no receipt'
  summary.click()
  await new Promise(r => setTimeout(r, 600))
  const list = document.querySelector('.lc-receipt')
  const pairs = {}
  if (list !== null) {
    const kids = [...list.children]
    for (let i = 0; i < kids.length - 1; i += 1) {
      // Keyed UPPERCASE: the headings are uppercased by CSS and innerText
      // returns what is rendered, so a sentence-case lookup found nothing and
      // reported the line absent while the screenshot showed it.
      if (kids[i].tagName === 'DT') pairs[kids[i].innerText.trim().toUpperCase()] = kids[i + 1].innerText.trim()
    }
  }
  const ranOn = pairs['RAN ON'] ?? 'absent'
  return JSON.stringify({
    headings: Object.keys(pairs),
    ranOn,
    runtime: pairs['RUNTIME'] ?? 'absent',
    saysPlatform: /Windows|macOS|Linux/.test(ranOn),
    namesTheFolder: /locust-receipt-ws-/.test(ranOn),
    // The ruling's rule: scope, never absence. Nothing here may read as a
    // warning about what was skipped.
    saysAbsence: /not |never|untested|missing|without/i.test(ranOn)
  }, null, 1)
})()`

let profile
try {
  const first = await startDrive({ name: 'receipt-says-where', port: 9502, workspace, spends: true, keep: true, seed: SEED })
  try {
    await first.capture('run one mission, then quit', async () => {
      await first.ready()
      return first.evaluate(send)
    })
  } finally {
    const out = await first.finish({ intro: 'First launch: one mission, so the ledger has something to reopen.', last: false })
    profile = out.profile
  }

  // Same profile, same record: the app comes back to a ledger it did not
  // write this session, which is what makes the mission a RESTORED one.
  const second = await startDrive({
    name: 'receipt-says-where',
    port: 9502,
    workspace,
    spends: true,
    profilePath: profile,
    outPath: undefined,
    stepFrom: 1
  })
  try {
    await second.capture('reopen it after a restart and read the receipt', async () => {
      await second.ready()
      return second.evaluate(readReceipt)
    })
  } finally {
    await second.finish({
      intro: 'Second launch on the same profile. A mission reopened from the ledger must carry `Ran on <platform> · <folder>` on its receipt, and must say nothing that reads as a warning.'
    })
  }
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
}
