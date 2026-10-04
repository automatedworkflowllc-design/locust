// Locust itself, not only the card, refuses "Always" for a command that reaches (0.598).
//
//   node _tools/drive-the-host-refuses-always.mjs [--packaged <exe>] [--tag <name>]
//
// Free model, in Approve each. Wren is asked to run
// `taskkill /IM locust-no-such-program.exe` twice, as two steps -- a name no
// program has, so it could stop nothing even if it ran. The card for it hides
// "Always allow this session" (0.579); this drive sends `approve-always`
// anyway, THROUGH THE PRELOAD, the way a stale window or a devtools call
// would. Before 0.598 the host took it: the runtime remembered the command
// and ran it the second time with no card, and the record said
// "allowed-always". Since 0.598 the host applies it as this once: the second
// run of the same command raises a card again, and the record says "allowed"
// with the words "asked each time: stops every locust-no-such-program.exe".
//
// Nothing is spent.

import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `the-host-refuses-always-${tag}`)
await mkdir(OUT, { recursive: true })
const PROGRAM = 'locust-no-such-program.exe'
const COMMAND = `taskkill /IM ${PROGRAM}`
const workspace = await scratchRepository('locust-refuses-always-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-refuses-always-profile-'))
const drive = await startDrive({
  name: `the-host-refuses-always-${tag}`, port: 9795, workspace, profilePath, outPath: OUT, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'approve-each' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const running = async () => String(await drive.evaluate(`String(document.querySelector('button[aria-label^="Stop the running"]') !== null)`)) === 'true'
// The card on screen, and the request the window was sent for it (kept by our own listener on the preload).
const CARD = `JSON.stringify((() => {
  const actions = [...document.querySelectorAll('.lc-approval__actions')].at(-1)
  if (!actions) return { shown: false }
  const card = actions.closest('.lc-card')
  const rows = {}
  for (const dt of card?.querySelectorAll('.lc-receipt dt') ?? []) rows[dt.textContent.trim()] = dt.nextElementSibling?.textContent.replace(/\\s+/g, ' ').trim() ?? ''
  const buttons = [...actions.querySelectorAll('button')].map((b) => b.innerText.trim())
  const requests = window.__locustApprovals ?? []
  return { shown: true, rows, buttons, approvalId: requests.at(-1)?.approvalId ?? null, requests: requests.length }
})())`
const DENY = `(() => {
  const button = [...document.querySelectorAll('.lc-approval__actions button')].find((b) => /^Deny/.test(b.innerText.trim()))
  button?.click()
  return new Promise((r) => setTimeout(() => {
    const confirm = [...document.querySelectorAll('.lc-approval__actions button, .lc-card button')].find((b) => /^Deny$/.test(b.innerText.trim()) && b !== button)
    confirm?.click()
    r(button ? 'denied' : 'no deny button')
  }, 400))
})()`
try {
  await drive.ready()
  await drive.resize(1440, 900)
  // Our own listener, beside the app's: the request ids the window is sent.
  await drive.evaluate(`(() => { window.__locustApprovals = []; window.desktop.onMissionApproval((request) => { window.__locustApprovals.push(request) }); return true })()`)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(`Run exactly this one shell command: ${COMMAND}  Wait for its result, then run exactly the same command a second time as a separate step. Nothing else. Then reply with the word DONE.`)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'not sent'
  })()`))
  check('the task is sent', sent === 'sent', sent)
  const cards = []
  let sentAlways
  let lastId
  for (let i = 0; i < 360; i += 1) {
    await sleep(1000)
    const card = JSON.parse(String(await drive.evaluate(CARD)))
    if (card.shown && card.approvalId !== null && card.approvalId !== lastId) {
      lastId = card.approvalId
      cards.push({ exact: card.rows.Exact ?? '', buttons: card.buttons })
      if (sentAlways === undefined && /taskkill/i.test(card.rows.Exact ?? '')) {
        await drive.capture('the first card: Always is not offered', async () => JSON.stringify(card))
        // What a stale window or a devtools call would send: Always, through the preload, past the hidden button.
        sentAlways = JSON.parse(String(await drive.evaluate(`window.desktop.decideMissionApproval({ approvalId: ${JSON.stringify(card.approvalId)}, decision: 'approve-always' }).then((r) => JSON.stringify(r))`)))
        continue
      }
      await drive.capture('a later card', async () => JSON.stringify(card))
      await drive.evaluate(DENY)
      continue
    }
    if (i > 10 && !(await running())) break
  }
  say(`  cards: ${JSON.stringify(cards)}`)
  const first = cards.find((card) => /taskkill/i.test(card.exact))
  check('a card asked about the command, without Always on it', first !== undefined && !first.buttons.some((b) => /Always|ask again/i.test(b)), JSON.stringify(first))
  check('the window was allowed to send Always for it anyway (the preload took the call)', sentAlways?.ok === true, JSON.stringify(sentAlways))
  check('0.598: the SAME command asked again on its second run (the host applied Always as this once)', cards.filter((card) => /taskkill/i.test(card.exact)).length >= 2, `${String(cards.length)} cards`)
  check('the run ended', !(await running()))
  // The record: what the host wrote down for the first answer.
  const ledgerDir = join(profilePath, 'mission-ledger')
  const files = (await readdir(ledgerDir).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const approvals = []
  for (const name of files) {
    for (const line of (await readFile(join(ledgerDir, name), 'utf8')).split(/\r?\n/)) {
      if (!line.includes('"mission.approval"')) continue
      try { const record = JSON.parse(line); approvals.push(record.approval ?? record) } catch { /* a torn tail is not a record */ }
    }
  }
  say(`  approvals recorded: ${JSON.stringify(approvals.map((a) => ({ answer: a.answer, words: a.words, kind: a.kind }))).slice(0, 400)}`)
  const recorded = approvals.find((a) => /taskkill/i.test(String(a.asked ?? '')))
  check('0.598: the record says allowed, not allowed-always', recorded?.answer === 'allowed', recorded?.answer)
  check('0.598: and says why: asked each time, with what it reaches', /asked each time: stops every/.test(String(recorded?.words ?? '')), recorded?.words)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on a free model in Approve each, asked to run ${COMMAND} twice; the first card answered with Always through the preload, past the hidden button.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'THE HOST REFUSES ALWAYS PASSED' : `THE HOST REFUSES ALWAYS: FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
