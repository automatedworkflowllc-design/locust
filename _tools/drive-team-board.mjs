// The Team screen as a board (0.380): four teammates, four states at once.
//
//   node _tools/drive-team-board.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. Wren is asked to run a command in Approve each and left waiting
// (Needs you); Sable is given a long job (Working); Juno is asked for one word
// and the person leaves before it lands (Just finished -- not seen); Quill is
// left alone (Ready). Then the Team screen, photographed: the sections, in
// order, with the right people in each, amber and green where they belong.
// Then Juno is opened, and must leave "Just finished" for having been seen.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('team-board-2026-09-26'), `team-board-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const at = '2026-09-26T05:00:00.000Z'
const mate = (teammateId, name, hue, role, mode) => ({ teammateId, name, hue, role, createdAt: at, route: { runtime: 'opencode', model: MODEL, mode } })

const workspace = await scratchRepository('locust-team-board-ws-')
const drive = await startDrive({
  name: `team-board-${tag}`,
  port: 9683,
  workspace,
  launchElsewhere: true,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      mate('tm_wren', 'Wren', 'lime', 'Code & Migrations', 'accept-edits'),
      mate('tm_juno', 'Juno', 'violet', 'Docs & QA', 'accept-edits'),
      mate('tm_sable', 'Sable', 'blue', 'Data & Reporting', 'accept-edits'),
      mate('tm_quill', 'Quill', 'clay', 'Research & Briefs', 'accept-edits')
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
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
  return 'could not send'
})()`)
const approveEach = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const item = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => b.innerText.trim().startsWith('Approve each'))
  if (!item || item.disabled) { control.click(); return 'not offered' }
  item.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`
const teamScreen = async () => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50, modifiers: 2 })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50, modifiers: 2 })
  await sleep(800)
}
/** The board as drawn: each section's title and the names in it, in order. */
const BOARD = `JSON.stringify([...document.querySelectorAll('.lc-boardsection')].map((section) => ({
  key: [...section.classList].find((name) => name.startsWith('lc-boardsection--'))?.slice(17),
  names: [...section.querySelectorAll('.lc-rostercard__name')].map((el) => el.textContent.trim()).filter((name) => name !== 'New teammate'),
  tinted: [...section.querySelectorAll('.lc-rostercard')].filter((card) => getComputedStyle(card).borderColor !== getComputedStyle(document.querySelector('.lc-rostercard--new') ?? card).borderColor).length,
  dots: [...section.querySelectorAll('.lc-rostercard__mission .lc-dot')].map((dot) => [...dot.classList].find((name) => name.startsWith('lc-tone-')))
})))`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  // Sable: a long job, left to run.
  await drive.evaluate(openTeammateScript('Sable'))
  say(`Sable: ${String(await send('Count from 1 to 250, one number per line, and nothing else. Do not use any tools.'))}`)
  await sleep(600)
  // Wren: Approve each, a command that must be asked about -- left waiting.
  await drive.evaluate(openTeammateScript('Wren'))
  say(`Wren: ${String(await drive.evaluate(approveEach))}; ${String(await send('Run exactly this shell command with your bash tool: echo BOARD > board.txt'))}`)
  await sleep(600)
  // Juno: one word, and the person is gone before it lands.
  await drive.evaluate(openTeammateScript('Juno'))
  say(`Juno: ${String(await send('Reply with exactly one word: ready. Do not use any tools.'))}`)
  await teamScreen()
  // Wait for Wren's card to be up and Juno to have finished, Sable still going.
  let board = []
  for (let i = 0; i < 240; i += 1) {
    board = JSON.parse(String(await drive.evaluate(BOARD)))
    const where = (name) => board.find((section) => section.names.includes(name))?.key
    if (where('Wren') === 'needs-you' && where('Juno') === 'finished') break
    await sleep(1000)
  }
  const where = (name) => board.find((section) => section.names.includes(name))?.key
  await drive.capture('the Team screen, as a board', () => JSON.stringify(board))
  check('the sections come most urgent first', JSON.stringify(board.map((section) => section.key)) === JSON.stringify(board.map((section) => section.key).sort((a, b) => ['needs-you', 'working', 'finished', 'ready'].indexOf(a) - ['needs-you', 'working', 'finished', 'ready'].indexOf(b))), JSON.stringify(board.map((section) => section.key)))
  check('Wren, waiting on an approval, is under Needs you', where('Wren') === 'needs-you', where('Wren'))
  check('Juno, finished while the person was elsewhere, is under Just finished', where('Juno') === 'finished', where('Juno'))
  check('Sable is Working (or already finished)', where('Sable') === 'working' || where('Sable') === 'finished', where('Sable'))
  check('Quill, never asked, is Ready', where('Quill') === 'ready', where('Quill'))
  const tints = Object.fromEntries(board.map((section) => [section.key, section.tinted]))
  // A live mission is running, not interrupted: the record has no word for
  // running, and its Recent dot was red on the first frames of this board.
  const liveDots = board.filter((section) => section.key === 'needs-you' || section.key === 'working').flatMap((section) => section.dots)
  check('a live mission’s Recent dot is the running lime, never red', liveDots.length > 0 && liveDots.every((tone) => tone === 'lc-tone-lime'), JSON.stringify(liveDots))
  check('only Needs you and Just finished are tinted', (tints['needs-you'] ?? 0) > 0 && (tints.finished ?? 0) > 0 && (tints.working ?? 0) === 0 && (tints.ready ?? 0) === 0, JSON.stringify(tints))
  // Seen: Juno opened, and back to the board.
  await drive.evaluate(openTeammateScript('Juno'))
  await sleep(800)
  await teamScreen()
  const after = JSON.parse(String(await drive.evaluate(BOARD)))
  const juno = after.find((section) => section.names.includes('Juno'))?.key
  await drive.capture('after Juno is opened', () => JSON.stringify(after))
  check('once Juno is opened, the finish is seen: Juno is Ready', juno === 'ready' || juno === undefined, String(juno))
  say(failures === 0 ? '\nTEAM BOARD PASSED' : `\nTEAM BOARD: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Four teammates on ${MODEL}: Wren waiting on an approval, Sable on a long job, Juno finished unseen, Quill never asked -- the Team screen as a board, then Juno opened.` })
}
