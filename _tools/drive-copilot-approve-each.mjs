// Approve each on Copilot, over the Agent Client Protocol (0.377).
//
//   LOCUST_SPEND=1 node _tools/drive-copilot-approve-each.mjs [--packaged <exe>] [--tag <name>]
//
// Copilot's print mode could only be told in advance what it may do. Over ACP
// (`copilot --acp`) it stops and asks, and the card is the one every runtime
// uses. Wren on Copilot (auto), in Approve each:
//
//   1. a shell command, approved once -- it must run, and in the folder;
//   2. one denied with a reason typed by real key events -- it must not run,
//      the call must read refused, and the reason must reach Copilot as its
//      next prompt (ACP's answer has no room for one);
//   3. the next message in Ask -- Copilot's print route -- must continue the
//      same session, knowing what the reason asked for.
//
// Four premium requests: the approved turn, the denied turn, the reason sent
// on, the follow-up. Any card after the first denial is denied too.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('copilot-approve-each-2026-09-26'), `copilot-approve-each-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-copilot-acp-ws-')
const drive = await startDrive({
  name: `copilot-approve-each-${tag}`,
  port: 9677,
  spends: true,
  // LOCUST_DRIVE_KEEP=1 leaves the profile, and its record, for reading afterwards.
  keep: process.env.LOCUST_DRIVE_KEEP === '1',
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'copilot', model: 'auto', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const CARD = `document.querySelector('[role=group][aria-label="Approval required"]')`
const RUNNING = `document.querySelector('button[aria-label^="Stop the running"]')`
const THREAD = `(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')`

/** Choose a mode from the composer's menu by the start of its label. */
const chooseMode = (label) => `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const items = [...document.querySelectorAll('[role=menuitemradio]')]
  const item = items.find((b) => b.innerText.trim().startsWith(${JSON.stringify(label)}))
  if (!item) { control.click(); return 'NOT OFFERED: ' + items.map((b) => b.innerText.split(/\\s+/).join(' ').slice(0, 60)).join(' | ') }
  if (item.disabled) { const why = item.getAttribute('title'); control.click(); return 'DISABLED: ' + why }
  item.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`

/** Send a message, then wait for the first card, or for the run to end without one. */
const sendAndWaitForCard = (text) => `(async () => {
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
    const card = ${CARD}
    if (card) { await new Promise((r) => setTimeout(r, 300)); return 'card: ' + card.innerText.split(/\\s+/).join(' ').slice(0, 300) }
    if (i > 8 && !${RUNNING}) return 'ended without asking'
  }
  return 'timed out'
})()`

/** Answer every card that comes with the same answer until the run ends. */
const answerUntilEnd = (answer) => `(async () => {
  const cards = []
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    const card = ${CARD}
    if (card && !card.querySelector('.lc-approval__reason')) {
      const button = ${answer === 'approve'
        ? `[...card.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))`
        : `card.querySelector('button.lc-denybutton')`}
      if (button) {
        cards.push((card.querySelector('code, pre, .lc-approval__exact')?.innerText ?? card.innerText).split(/\\s+/).join(' ').slice(0, 90))
        button.click()
        await new Promise((r) => setTimeout(r, 900))
        continue
      }
    }
    if (i > 8 && !${RUNNING} && !${CARD}) break
  }
  await new Promise((r) => setTimeout(r, 900))
  return String(cards.length) + ' more card(s) ${answer === 'approve' ? 'approved' : 'denied'}' + (cards.length === 0 ? '' : ': ' + cards.join(' ;; ')) + ' || thread: ' + ${THREAD}.slice(-360)
})()`

/** Wait for a run started in Ask to end, with no card expected. */
const sendAndWaitForEnd = (text) => `(async () => {
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
    if (i > 8 && !${RUNNING}) break
  }
  await new Promise((r) => setTimeout(r, 900))
  return ${THREAD}.slice(-360)
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(openTeammateScript('Wren'))

  // 1. Approve each is offered on Copilot now, and a command is asked about.
  const mode = String(await drive.capture('Wren on Copilot: Approve each chosen', () => drive.evaluate(chooseMode('Approve each'))))
  check('Approve each is offered for Copilot, and chosen', /^mode: Approve/.test(mode), mode)
  const asked = String(await drive.capture('Copilot asks before running the command', () =>
    drive.evaluate(sendAndWaitForCard('Run exactly this shell command with your shell tool: echo LOCUST-ACP-OK > approved.txt   Then reply in one sentence saying whether it ran.'))))
  check('Copilot stops and asks, naming the command', /^card: /.test(asked) && asked.includes('echo LOCUST-ACP-OK'), asked.slice(0, 200))
  // The first card's own answer, then any that follow (a look at the file, say).
  const approvedOnce = String(await drive.evaluate(`(async () => {
    const card = ${CARD}
    const button = card && [...card.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))
    if (!button) return 'no Approve once'
    button.click(); return 'approved'
  })()`))
  const afterApprove = String(await drive.capture('after approving once', () => drive.evaluate(answerUntilEnd('approve'))))
  const written = join(workspace, 'approved.txt')
  check('the approved command ran, in the folder', existsSync(written) && readFileSync(written, 'utf8').includes('LOCUST-ACP-OK'), `${approvedOnce} || ${existsSync(written) ? readFileSync(written, 'utf8').trim() : 'no approved.txt in the folder'} || ${afterApprove.slice(-160)}`)

  // 2. Denied, with a reason typed by real key events.
  const askedAgain = String(await drive.capture('Copilot asks before the second command', () =>
    drive.evaluate(sendAndWaitForCard('Run exactly this shell command with your shell tool: echo LOCUST-ACP-NO > denied.txt   If I decline, do what my reason says instead.'))))
  check('Copilot asks again, on a loaded session', /^card: /.test(askedAgain) && askedAgain.includes('LOCUST-ACP-NO'), askedAgain.slice(0, 200))
  const opened = String(await drive.evaluate(`(async () => {
    const card = ${CARD}
    ;[...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Deny…')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const field = card.querySelector('.lc-approval__reason')
    return JSON.stringify({ field: field !== null, focused: document.activeElement === field })
  })()`))
  check('Deny… opens the reason’s line, focused', JSON.parse(opened).field === true && JSON.parse(opened).focused === true, opened)
  const REASON = 'Do not write that file. Reply with the single word PEAR instead.'
  for (const character of REASON) await drive.send('Input.insertText', { text: character })
  await sleep(300)
  await drive.capture('the reason, typed on the card', () => drive.evaluate(`(() => ${CARD}?.querySelector('.lc-approval__reason')?.value ?? '')()`))
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  const afterDeny = String(await drive.capture('Copilot, after the reason', () => drive.evaluate(answerUntilEnd('deny'))))
  check('the denied command did not run', !existsSync(join(workspace, 'denied.txt')), afterDeny.slice(0, 120))
  check('the reason reached Copilot as its next prompt: it answered PEAR', /\bPEAR\b/i.test(afterDeny), afterDeny.slice(-240))
  const fold = String(await drive.evaluate(`(() => (document.querySelector('.lc-activity')?.innerText ?? '').replace(/[ ]+/g, ' '))()`))
  check('the denied call reads refused or declined, and nothing failed', /(declined|refused)/i.test(fold) && !/(failed|exited non-zero)/i.test(fold), fold.slice(0, 240))

  // 3. The next message, in Ask: Copilot's print route, on the same session.
  // Counted in the whole thread before and after: the follow-up's own words never say PEAR.
  const pears = async () => (String(await drive.evaluate(THREAD)).match(/\bPEAR\b/gi) ?? []).length
  const pearsBefore = await pears()
  const askMode = String(await drive.evaluate(chooseMode('Ask')))
  const followUp = String(await drive.capture('the next message, in Ask, on the same session', () =>
    drive.evaluate(sendAndWaitForEnd('Earlier, after I declined a command, I asked you to reply with a single word. Which word was it? Reply with just the word.'))))
  const pearsAfter = await pears()
  check('in Ask (the print route) the session continues: it remembers the word', /^mode: Ask/.test(askMode) && pearsAfter > pearsBefore, `${askMode} || ${followUp.slice(-200)}`)

  say(failures === 0 ? '\nCOPILOT APPROVE EACH PASSED' : `\nCOPILOT APPROVE EACH: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Copilot (auto), Approve each over ACP: one command approved once, one denied with a typed reason, then a follow-up in Ask on the print route.` })
}
