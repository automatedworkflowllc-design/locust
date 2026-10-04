// Approvals, as a person meets them (fresh-eyes check, area "Approvals").
//
//   node _tools/drive-approvals.mjs [--packaged <exe>] [--tag <name>]
//
// Free model, in Approve each (OpenCode asks through its server, A6.7).
//   1. Wren is asked to create hello.txt: an approval card, naming OpenCode
//      and showing the change; the title bar says it needs you, and its list
//      names the card; at 1120x720 the card's buttons are on screen.
//   2. Approve once: hello.txt lands, holding "hi".
//   3. Wren is asked to change hi to bye: Deny, with a reason typed: the file
//      is untouched and the conversation says it was declined.
// Every step is captured, to be looked at.

import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('approvals-2026-09-27'), `approvals-${tag}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-approvals-ws-')
const drive = await startDrive({
  name: `approvals-${tag}`, port: 9729, workspace, outPath: OUT, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'approve-each' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'not sent'
})()`)
const CARD = `JSON.stringify((() => {
  const actions = [...document.querySelectorAll('.lc-approval__actions')].at(-1)
  const card = actions?.parentElement?.closest('div')
  if (!actions) return { shown: false }
  const buttons = [...actions.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.innerText.trim(), onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth } })
  return {
    shown: true,
    title: document.querySelector('.lc-approval__title')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    patch: document.querySelector('.lc-approval__patch')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200) ?? '',
    file: document.querySelector('.lc-approval__file')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    buttons,
    needsYou: document.querySelector('.lc-needsyou')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    status: document.querySelector('.lc-approval__file .lc-filerow__status')?.textContent.trim() ?? '',
    // How far in from the card's edge the change's header line starts and ends.
    headInset: (() => {
      const head = document.querySelector('.lc-approval__patchhead')
      const patch = head?.parentElement
      if (!head || !patch) return null
      const h = [...head.children].map((c) => c.getBoundingClientRect()); const p = patch.getBoundingClientRect()
      return { left: Math.round(h[0].left - p.left), right: Math.round(p.right - h.at(-1).right) }
    })()
  }
})())`
const waitForCard = async () => {
  for (let i = 0; i < 360; i += 1) {
    const seen = JSON.parse(String(await drive.evaluate(CARD)))
    if (seen.shown) return seen
    if (i > 10 && String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'false') return seen
    await sleep(500)
  }
  return { shown: false }
}
/** Answer every card with `act` until the run is over (a waiting run still reads as running). */
const answerUntilEnd = async (act) => {
  for (let i = 0; i < 360; i += 1) {
    await sleep(1000)
    if (JSON.parse(String(await drive.evaluate(CARD))).shown) { await drive.evaluate(act); continue }
    if (String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'false') return
  }
}
const waitForEnd = async () => {
  for (let i = 0; i < 360; i += 1) {
    await sleep(500)
    if (String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'false') return
  }
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  // 1. A card.
  check('the first task is sent', String(await send('Create a file hello.txt containing the single line: hi. Change nothing else. Then reply with the word DONE.')) === 'sent')
  const card = await waitForCard()
  await drive.capture('the approval card', () => JSON.stringify(card))
  check('an approval card appears, naming OpenCode, before anything is written', card.shown && /OpenCode/.test(card.title + ' ' + card.patch) , JSON.stringify(card).slice(0, 240))
  check('it shows the change: hello.txt, with hi', /hello\.txt/.test(card.file + card.patch + card.title) && /hi/.test(card.patch), (card.file + ' | ' + card.patch).slice(0, 200))
  check('nothing is on disk yet', !(await readFile(join(workspace, 'hello.txt'), 'utf8').then(() => true, () => false)))
  // 0.410, seen in this drive's own capture on 0.409.
  check('a file that does not exist yet is marked ADDED, not MODIFIED', card.status === 'ADDED', card.status)
  check('the change’s header line is inset from the card’s edges, like the rest of it', card.headInset !== null && card.headInset.left >= 8 && card.headInset.right >= 8, JSON.stringify(card.headInset))
  check('the title bar says it needs you', /needs you/.test(card.needsYou), card.needsYou)
  const list = String(await drive.capture('the needs-you list', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-needsyou')?.click()
    await new Promise((r) => setTimeout(r, 600))
    const menu = document.querySelector('[role=menu]')
    const text = menu?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no list'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return text
  })()`)))
  check('its list names Wren and what is waiting', /Wren/.test(list), list.slice(0, 160))
  await drive.resize(1120, 720)
  await sleep(900)
  const small = JSON.parse(String(await drive.capture('the approval card at 1120x720', () => drive.evaluate(CARD))))
  check('1120x720: the card’s buttons are all on screen', small.shown && small.buttons.length >= 3 && small.buttons.every((b) => b.onScreen), JSON.stringify(small.buttons))
  await drive.resize(1440, 900)
  await sleep(600)
  // 2. Approve once.
  await drive.evaluate(`[...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Approve once$|^Allow once$/.test(b.innerText.trim()))?.click()`)
  // The model may ask again for further steps (a read-back); approve them
  // all until the run ends -- a fixed three rounds left one run waiting.
  await answerUntilEnd(`[...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Approve once$|^Allow once$/.test(b.innerText.trim()))?.click()`)
  await sleep(1500)
  await drive.capture('approved: the run finished', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-240) ?? ''`))
  const written = await readFile(join(workspace, 'hello.txt'), 'utf8').catch(() => '(missing)')
  check('approved once: hello.txt landed, holding hi', written.trim() === 'hi', JSON.stringify(written))
  // 3. Deny, with a reason.
  check('the second task is sent', String(await send('Now change the line in hello.txt from hi to bye. Then reply with the word DONE.')) === 'sent')
  const second = await waitForCard()
  check('a card for the change appears', second.shown, JSON.stringify(second).slice(0, 200))
  const reason = String(await drive.capture('Deny, with a reason typed', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Deny/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 500))
    const box = document.querySelector('.lc-approval__reason')
    if (!box) return 'no reason box'
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set
    setter.call(box, 'Keep it as hi, please.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    return 'typed: ' + box.value
  })()`)))
  check('Deny opens a box for why', /^typed: Keep it as hi/.test(reason), reason)
  await drive.evaluate(`document.querySelector('.lc-approval__deny button[type="submit"], .lc-approval__deny .lc-denybutton')?.click()`)
  // Any further ask in this turn is declined too, without a reason.
  await answerUntilEnd(`(async () => { [...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Deny/.test(b.innerText.trim()))?.click(); await new Promise((r) => setTimeout(r, 400)); document.querySelector('.lc-approval__deny .lc-denybutton')?.click() })()`)
  await sleep(1500)
  const after = String(await drive.capture('denied: the run finished', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-400) ?? ''`)))
  const kept = await readFile(join(workspace, 'hello.txt'), 'utf8').catch(() => '(missing)')
  check('denied: hello.txt is untouched', kept.trim() === 'hi', JSON.stringify(kept))
  // 0.410: in the person's own word -- "declined" -- never the mode's word
  // "refused" (a denial with a reason was drawn "1 refused ... edit refused").
  // Any count: a model may ask again after the denial (0.467 run: "2 declined",
  // a git status the drive also denied). The wording is what this guards.
  check('and the steps say the person declined it, not that a mode refused it', /\d+ declined/.test(after) && !/refused/.test(after), after.slice(-240))
  // 0.576 (ledger v20): every card answered is written down with the turn, by whom, and with the words said.
  const ledgerDir = join(drive.profile, 'mission-ledger')
  const records = (await Promise.all((await readdir(ledgerDir).catch(() => [])).filter((name) => name.endsWith('.jsonl')).map((name) => readFile(join(ledgerDir, name), 'utf8'))))
    .flatMap((text) => text.split('\n').filter((line) => line.includes('"mission.approval"')).map((line) => JSON.parse(line).approval))
  check('the ledger holds the card approved once, as allowed on the card', records.some((one) => one.answer === 'allowed' && one.by === 'card'), JSON.stringify(records).slice(0, 300))
  check('and the card denied, with the reason the person typed', records.some((one) => one.answer === 'denied' && one.by === 'card' && one.words === 'Keep it as hi, please.'), JSON.stringify(records).slice(0, 300))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on a free model in Approve each; one change approved, one denied with a reason.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
