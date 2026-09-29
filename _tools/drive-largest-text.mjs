// A question card grows with the reply size (0.480, QA-2026-09-29 round 2, N8).
//
//   node _tools/drive-largest-text.mjs [--packaged <exe>]
//
// At Largest the reply was 19px and the card a person must read to decide
// stayed at 12px, as did their own message. This seeds a conversation whose
// last reply asks a question, opens it at Standard and at Largest, reads the
// drawn sizes, and checks the card still fits its column. Sends nothing.

import { CONVERSATIONS, seedEverydayLedger } from './everyday-ledger.mjs'
import { say, sleep, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const ASKED = 'Pick the queue for the nightly import'
CONVERSATIONS.unshift(['Wren', 0.01, [ASKED, [
  'Two queues fit. Which should the nightly import use?',
  '',
  '<locust-ask>',
  'The import runs at 2am. Put it on the shared queue, or give it its own?',
  '- Shared queue :: No new setup, but it waits behind the backups',
  '- Its own queue :: One more worker to run, starts on time',
  '</locust-ask>'
].join('\n')]])
const everyday = await seedEverydayLedger('largest-text')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'largest-text', port: 9753, workspace: everyday.workspace, profilePath: everyday.profilePath, sendsNothing: true,
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const open = `(async () => {
  for (let i = 0; i < 40; i += 1) {
    const row = [...document.querySelectorAll('button, a, [role="button"]')].find((el) => el.innerText.includes(${JSON.stringify(ASKED)}))
    if (row) { row.click(); break }
    await new Promise((r) => setTimeout(r, 250))
  }
  for (let i = 0; i < 40 && !document.querySelector('.lc-decision'); i += 1) await new Promise((r) => setTimeout(r, 250))
  return !!document.querySelector('.lc-decision')
})()`
const sizes = (choice) => `(async () => {
  document.documentElement.dataset.replysize = ${JSON.stringify(choice)}
  await new Promise((r) => setTimeout(r, 400))
  const size = (selector) => { const el = document.querySelector(selector); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 }
  const card = document.querySelector('.lc-decision')
  return JSON.stringify({
    reply: size('.lc-agentline__body p'),
    question: size('.lc-decision__question'),
    label: size('.lc-decision__label'),
    note: size('.lc-decision__note'),
    foot: size('.lc-decision__foot'),
    bubble: size('.lc-bubble'),
    fits: card ? card.scrollWidth <= card.clientWidth + 1 : false,
    page: document.documentElement.scrollWidth <= window.innerWidth + 1
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  check('the conversation with a question opens', await drive.evaluate(open) === true)
  const standard = JSON.parse(String(await drive.capture('at Standard', () => drive.evaluate(sizes('standard')))))
  const largest = JSON.parse(String(await drive.capture('at Largest', () => drive.evaluate(sizes('largest')))))
  say(`  standard ${JSON.stringify(standard)}`)
  say(`  largest  ${JSON.stringify(largest)}`)
  check('the reply grows, as it did', largest.reply > standard.reply, `${standard.reply} -> ${largest.reply}`)
  for (const part of ['question', 'label', 'note', 'foot', 'bubble']) {
    check(`the ${part} grows with it`, standard[part] > 0 && largest[part] > standard[part], `${standard[part]} -> ${largest[part]}`)
  }
  check('the card fits its column at Largest', largest.fits && largest.page)
  await sleep(200)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A seeded conversation with a question; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
