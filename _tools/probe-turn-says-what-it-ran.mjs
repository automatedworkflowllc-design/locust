// Does a finished turn say what it RAN, not only what it changed?
//
//   LOCUST_SPEND=1 node _tools/probe-turn-says-what-it-ran.mjs
//
// Astra, 2026-09-11: a turn's line says what it CHANGED -- `3 files` -- and
// never what it ran, so a run that edited three files and a run that edited
// three files and proved them read identically. The ledger has had the
// commands and their exit codes the whole time.
//
// The rule, and the reason this is part 1a rather than the whole proposal:
// NO INFERENCE ABOUT WHAT A COMMAND MEANS. Nothing decides that `pnpm test`
// is a test and `ls` is not. The line says what ran and what came back; a
// reader decides whether that is evidence.
//
// What this measures, on a real run asked to do exactly that: the closed
// trace line names the commands and their outcome, and an ordinary tool call
// is still counted separately rather than swallowed by them.
//
// SPENDS one Claude Code turn on sonnet at low effort.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-ranwhat-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'turn-says-what-it-ran',
  port: 9500,
  workspace,
  spends: true,
  seed: {
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
})

const ASK = 'Run these three shell commands, one at a time, and change no files: '
  + 'first `echo one`, then `echo two`, then `echo three`. Then reply with the word done.'

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
  return 'sent'
})()`

const watch = `(async () => {
  const busy = () => [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|using|starting|writing/i.test(n.innerText))
  let quiet = 0
  for (let i = 0; i < 900; i += 1) {
    await new Promise(r => setTimeout(r, 400))
    quiet = busy() ? 0 : quiet + 1
    if (quiet >= 12) break
  }
  await new Promise(r => setTimeout(r, 1200))
  // The closed trace line IS the fold's own button, and its counts sit in
  // lc-activity__counts. The first run of this probe guessed at a class that
  // does not exist and reported 'no trace line' for a card on screen -- and
  // the fix then put a BACKTICK in a comment inside this template literal,
  // ending the string, which is the trap this file's own header warns about.
  const receipt = document.querySelector('.lc-receipt__summary')
  if (receipt !== null) { receipt.click(); await new Promise(r => setTimeout(r, 400)) }
  const counts = document.querySelector('.lc-activity__counts')
  const trace = document.querySelector('.lc-activity')
  const line = counts?.innerText.split(String.fromCharCode(10)).join(' ').trim()
    ?? trace?.innerText.split(String.fromCharCode(10)).join(' ').trim()
    ?? 'no trace line'
  return JSON.stringify({
    line,
    saysWhatItRan: /ran /i.test(line),
    // The ruling, 2026-09-11: the success case NAMES the commands and must
    // not grade them. Anything here reading as a verdict is the defect.
    gradesThem: /exit 0|passed|checked|verified|all ok/i.test(line),
    saysHowTheyCameOut: /exited non-zero|did not report/i.test(line),
    ranOn: document.querySelector('.lc-receipt')?.innerText.split(String.fromCharCode(10)).join(' ').slice(0, 200) ?? 'receipt closed',
    traceSeen: trace !== null
  }, null, 1)
})()`

const sendThenWatch = `(async () => {
  const sent = await ${send}
  if (sent !== 'sent') return 'NOT THE TEST: ' + String(sent)
  return await ${watch}
})()`

try {
  await drive.capture('a turn that ran three commands and changed nothing', async () => {
    await drive.ready()
    return drive.evaluate(sendThenWatch)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet asked to run three shell commands and change nothing. The closed trace line must name what it ran and how the commands came out.'
  })
}
