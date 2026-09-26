// Deny, and say why (0.374).
//
//   node _tools/drive-deny-with-reason.mjs [--packaged <exe>] [--tag <name>]
//
// A bare denial left a teammate to guess what was wrong. Deny now opens one
// line for the reason, and on OpenCode the reason rides the reject itself
// (the model reads its message -- measured on 1.18.27).
//
// Wren, on a free OpenCode model in Approve each, is asked to delete a folder.
// The drive presses Deny..., types a reason with real key events -- "keep the
// folder; write kept.txt instead" -- and presses Enter, then approves whatever
// Wren asks next. The folder must still be there; kept.txt is the evidence
// Wren read the reason and changed course.
//
// Free model by default. LOCUST_DENY_ON_CODEX=1 (with LOCUST_SPEND=1) runs
// Wren on Codex (GPT-6-Luna, low effort) instead: Codex's reply has no room
// for a reason, so there the reason reaches the run as its next input.

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('deny-with-reason-2026-09-26'), `deny-with-reason-${tag}`)
await mkdir(OUT, { recursive: true })

const ON_CODEX = process.env.LOCUST_DENY_ON_CODEX === '1'
const MODEL = ON_CODEX ? 'gpt-6-luna' : process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const ROUTE = ON_CODEX ? { runtime: 'codex', model: MODEL, mode: 'accept-edits', effort: 'low' } : { runtime: 'opencode', model: MODEL, mode: 'accept-edits' }
const workspace = await scratchRepository('locust-deny-reason-ws-')
await mkdir(join(workspace, 'build'), { recursive: true })
await writeFile(join(workspace, 'build', 'artifact.txt'), 'built\n')
const drive = await startDrive({
  name: `deny-with-reason-${tag}`,
  port: 9675,
  spends: ON_CODEX,
  // LOCUST_DRIVE_KEEP=1 leaves the profile, and its record, for reading afterwards.
  keep: process.env.LOCUST_DRIVE_KEEP === '1',
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const MODE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const approve = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => /^Approve each/.test(b.innerText.trim()))
  if (!approve || approve.disabled) { control.click(); return 'approve each not offered' }
  approve.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`
const CARD = `document.querySelector('[role=group][aria-label="Approval required"]')`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(openTeammateScript('Wren'))
  const mode = String(await drive.evaluate(MODE))
  const asked = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify('Delete the build folder: run exactly rm -rf build with your bash tool. If I decline, do what my reason says instead, then tell me in one sentence what you did.')})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      if (${CARD}) return 'card'
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended without asking'
    }
    return 'timed out'
  })()`))
  check('Wren, in Approve each, asks before deleting the folder', /^mode: Approve/.test(mode) && asked === 'card', `${mode} || ${asked}`)

  // Deny... opens the reason's line, focused.
  const opened = await drive.capture('Deny… opens a line for the reason', () => drive.evaluate(`(async () => {
    const card = ${CARD}
    ;[...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Deny…')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const field = card.querySelector('.lc-approval__reason')
    return JSON.stringify({ field: field !== null, focused: document.activeElement === field, placeholder: field?.getAttribute('placeholder') ?? '', button: card.querySelector('button[type=submit].lc-denybutton')?.innerText.trim() ?? '' })
  })()`))
  const deny = JSON.parse(String(opened))
  check('the reason’s line is there and focused, and the button still says Deny', deny.field && deny.focused && deny.button === 'Deny', String(opened))
  const REASON = 'Keep the build folder. Create a file named kept.txt containing the word kept instead.'
  for (const character of REASON) await drive.send('Input.insertText', { text: character })
  await sleep(300)
  const typed = String(await drive.evaluate(`(() => ${CARD}?.querySelector('button[type=submit].lc-denybutton')?.innerText.trim() ?? '')()`))
  check('with a reason typed, the button says so', typed === 'Deny and say why', typed)
  await drive.capture('the reason, typed', () => drive.evaluate(`(() => ${CARD}?.querySelector('.lc-approval__reason')?.value ?? '')()`))
  // A real Enter: the key, and the character a keyboard sends with it.
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })

  // Whatever Wren asks next -- writing kept.txt -- is approved.
  const after = String(await drive.evaluate(`(async () => {
    let approved = 0
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      const card = ${CARD}
      if (card && !card.querySelector('.lc-approval__reason')) {
        const approve = [...card.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))
        if (approve) { approve.click(); approved += 1; await new Promise((r) => setTimeout(r, 900)); continue }
      }
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'approved ' + String(approved) + ' || ' + (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-300)
  })()`))
  await drive.capture('Wren, after the reason', () => after)
  check('the folder was not deleted', existsSync(join(workspace, 'build', 'artifact.txt')), after.slice(0, 200))
  check('Wren read the reason and wrote kept.txt instead', existsSync(join(workspace, 'kept.txt')), after.slice(0, 300))
  // The denied call reads as refused, never as a failure (0.375): Codex
  // reports it as a failed script.
  const fold = String(await drive.evaluate(`(() => (document.querySelector('.lc-activity')?.innerText ?? '').replace(/[ ]+/g, ' '))()`))
  check('the denied call reads declined or refused, and nothing failed or exited non-zero', /(declined|refused)/.test(fold) && !/(failed|exited non-zero)/.test(fold), fold.slice(0, 240))
  say(failures === 0 ? '\nDENY WITH REASON PASSED' : `\nDENY WITH REASON: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Wren on ${MODEL}, Approve each. Asked to delete build/; denied with a reason typed by key events ("keep it; write kept.txt instead"); whatever came next approved.` })
}
