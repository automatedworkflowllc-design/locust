// A saved approval rule answers the same card next time, and says so (0.521).
//
//   LOCUST_SPEND=1 node _tools/drive-a-saved-approval-rule.mjs [--packaged <exe>] [--tag <name>]
//
// Product ideas (Bloks note, item 1): an approval card's "Always" becomes a
// rule the person can see and remove. Wren on Codex (GPT-6-Luna, low effort:
// Codex quota, which may be spent), in Approve each, is asked to run one
// harmless read-only command. The card must offer "Yes, and don't ask again"
// and say the rule it would save; pressed, the run goes on. Asked to run the
// same command again, no card may appear: the conversation says the saved
// rule allowed it. Settings > Teammates lists the rule with its count, and
// Remove takes it away.

import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// Not on Codex's own list of commands it runs without asking (git status is: the first try ran it unasked).
const COMMAND = 'node --version'
const workspace = await scratchRepository('locust-drive-saved-rule-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `saved-approval-rule-${tag}`,
  port: 9843,
  spends: true,
  workspace,
  outPath: join(recordRoot('a-saved-approval-rule-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'approve-each', effort: 'low' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const CARD = `document.querySelector('[role=group][aria-label="Approval required"]')`
// Approve each, chosen in the composer as a person would (the deny drive's own control).
const MODE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const approve = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => /^Approve each/.test(b.innerText.trim()))
  if (!approve || approve.disabled) { control.click(); return 'approve each not offered' }
  approve.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`
// Sends, then waits for a card or the end of the run; says which, and what the thread ends with.
const sendAndWatch = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (button && !button.disabled) { button.click(); break }
  }
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    if (${CARD}) return JSON.stringify({ card: true, text: ${CARD}.innerText.replace(/\\s+/g, ' ').trim() })
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 800))
  return JSON.stringify({ card: false, thread: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-1200) ?? '' })
})()`
// Codex may read its brief first: any card that is not about the command is approved once, as a person would.
const toTheCommandCard = `(async () => {
  for (let tries = 0; tries < 6; tries += 1) {
    const card = ${CARD}
    if (!card) return JSON.stringify({ card: false })
    const text = card.innerText.replace(/\\s+/g, ' ').trim()
    if (/node --version/.test(text)) return JSON.stringify({ card: true, text, skipped: tries })
    ;[...card.querySelectorAll('button')].find((b) => /^Approve once$/.test(b.innerText.trim()))?.click()
    for (let i = 0; i < 300; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      if (${CARD} && ${CARD} !== card) break
      if (i > 8 && !${CARD} && !document.querySelector('button[aria-label^="Stop the running"]')) return JSON.stringify({ card: false })
    }
  }
  return JSON.stringify({ card: false })
})()`
const waitForEnd = `(async () => {
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    if (${CARD}) return JSON.stringify({ card: true, text: ${CARD}.innerText.replace(/\\s+/g, ' ').trim() })
    if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 800))
  return JSON.stringify({ card: false, thread: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-1200) ?? '' })
})()`
const openRules = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'Teammates')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'Saved approvals')
  heading?.scrollIntoView()
  const section = heading?.closest('section')
  return section?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no Saved approvals section'
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)
  await drive.evaluate(openTeammateScript('Wren'))
  const mode = String(await drive.evaluate(MODE))
  check('the composer is in Approve each', /^mode: Approve/.test(mode), mode)
  // Codex's own policy runs some commands unasked on one turn and asks on the next (measured:
  // node --version ran unasked on turn 1 and was asked about on turn 2), so ask until it asks.
  let first = { card: false }
  for (let turn = 1; turn <= 3 && !first.card; turn += 1) {
    const sent = JSON.parse(String(await drive.evaluate(sendAndWatch(`Do not read any file first. Run exactly this command with your shell tool, once: ${COMMAND}\nThen reply with the words DONE ONE.`))))
    first = sent.card ? JSON.parse(String(await drive.capture(`asked to run it, turn ${String(turn)}: the card`, () => drive.evaluate(toTheCommandCard)))) : sent
    if (!first.card) say(`  turn ${String(turn)}: Codex ran it without asking; asking again`)
  }
  check('the card offers "Yes, and don\'t ask again", and says the rule it would save', first.card && /Yes, and don.t ask again/.test(first.text) && /saves a rule: Wren may run "node --version" in .* without asking\./.test(first.text), first.text ?? first.thread)
  // Deny… offers the other rule, then Back: nothing is answered by looking.
  const never = String(await drive.capture('Deny… offers Never allow this', () => drive.evaluate(`(async () => {
    const card = ${CARD}
    ;[...(card?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Deny…')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const label = card?.querySelector('.lc-approval__never')
    const said = (label?.innerText.trim() ?? 'no checkbox') + ' | ' + (label?.getAttribute('title') ?? '')
    ;[...(card?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Back')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return said
  })()`)))
  check('beside Deny, "Never allow this" says the rule it would save', /^Never allow this \(saves a rule\) \| Wren may not run "node --version" in .*\.$/.test(never), never)
  const pressed = String(await drive.capture('Yes, and don\'t ask again, pressed', () => drive.evaluate(`(async () => {
    ;[...(${CARD}?.querySelectorAll('button') ?? [])].find((b) => /Yes, and don.t ask again/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${CARD} ? 'card still there: ' + ${CARD}.innerText.slice(0, 200) : 'card gone'
  })()`)))
  check('pressed, the card goes and the run goes on', pressed === 'card gone', pressed)
  const ended = JSON.parse(String(await drive.evaluate(waitForEnd)))
  check('the first run finishes', !ended.card && /DONE ONE/.test(ended.thread ?? ''), (ended.thread ?? ended.text ?? '').slice(-300))

  const second = JSON.parse(String(await drive.capture('the same command again: no card', () => drive.evaluate(sendAndWatch(`Do not read any file first. Run exactly the same command again with your shell tool, once: ${COMMAND}\nThen reply with the words DONE TWO.`)))))
  check('asked again, no card: the saved rule answered it', second.card === false && /DONE TWO/.test(second.thread ?? ''), (second.text ?? second.thread ?? '').slice(-400))
  check('and the conversation says the rule allowed it', /Allowed by your saved rule: Wren may run "node --version" in .* without asking\. Settings > Teammates lists your rules\./.test(second.thread ?? ''), (second.thread ?? '').slice(-600))

  const listed = String(await drive.capture('Settings > Teammates: Saved approvals', () => drive.evaluate(openRules)))
  check('Settings lists the rule as its sentence, with how many cards it answered', /ALLOW Wren may run "node --version" in .* without asking\. Answered 1 card\./.test(listed), listed)
  const removed = String(await drive.capture('the rule, removed', () => drive.evaluate(`(async () => {
    const section = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'Saved approvals')?.closest('section')
    ;[...(section?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Remove')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return section?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
  })()`)))
  check('Remove takes it away', /None yet\./.test(removed), removed)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on Codex (GPT-6-Luna, low), Approve each; one harmless command, twice.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
