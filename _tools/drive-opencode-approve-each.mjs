// Approve each action on OpenCode (A6.7): does it stop, ask, and obey?
//
//   node _tools/drive-opencode-approve-each.mjs [--packaged <exe>] [--tag <label>]
//
// OpenCode's `run` could only reject what it would have asked, so Approve
// each was Codex-only. Through `opencode serve` it asks (measured 2026-09-25).
// Wren on the free Ling, in Approve each: one shell command approved once --
// it must run -- and one declined -- it must not, and the run must still end.
//
// Free model only.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `opencode-approve-each-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-oc-approve-ws-')
// The free model, by default the one the drive was written on; Ling is often busy.
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/ling-3.0-flash-fin-free'
/*
 * LAUNCHED ELSEWHERE (0.378). Launched IN the workspace, this drive passed
 * while OpenCode's server was started with no folder of its own: it stood
 * where the app stood, and the drive stood the app in the workspace. A real
 * launch stands in the install directory. So the app stands in its profile
 * folder here, and the file the approved command writes is looked for in
 * BOTH places -- the workspace, where it belongs, and the app's own folder.
 */
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'opencode-approve-each',
  port: 9321,
  workspace,
  launchElsewhere: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const MODE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const items = [...document.querySelectorAll('[role=menuitemradio]')]
  const approve = items.find((b) => /^Approve each/.test(b.innerText.trim()))
  if (!approve) { control.click(); return 'NO APPROVE EACH: ' + items.map((b) => b.innerText.split(/\\s+/).join(' ').slice(0, 60)).join(' | ') }
  if (approve.disabled) { const why = approve.getAttribute('title'); control.click(); return 'APPROVE EACH DISABLED: ' + why }
  approve.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`

/** Send, then answer the first card with the button named, and wait for the end. */
const ask = (text, answer) => `(async () => {
  const ANSWER = (approval) => ${answer === 'approve'
    ? `[...approval.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))`
    : `approval.querySelector('button.lc-denybutton')`}
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); break }
  }
  // Every card of this run gets the same answer: a model may look around
  // (ls, cat) before the command it was asked for, and each asks.
  const cards = []
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    const approval = document.querySelector('[role=group][aria-label="Approval required"]')
    if (approval) {
      await new Promise((r) => setTimeout(r, 300))
      cards.push((approval.querySelector('code, pre, .lc-approval__exact')?.innerText ?? approval.innerText).split(/\\s+/).join(' ').slice(0, 90))
      const button = ANSWER(approval)
      if (!button) break
      button.click()
      await new Promise((r) => setTimeout(r, 900))
      continue
    }
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  const card = cards.length === 0 ? 'no card' : String(cards.length) + ' card(s): ' + cards.join(' ;; ')
  await new Promise((r) => setTimeout(r, 900))
  const header = (document.querySelector('.lc-workroom__header')?.innerText ?? '').split(/\\s+/).join(' ').slice(0, 120)
  return 'card: ' + card + ' || header: ' + header + ' || thread: ' + (document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-200)
})()`

try {
  await drive.capture(`Wren on ${MODEL}: Approve each chosen`, async () => {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    return drive.evaluate(MODE)
  })
  await drive.capture('a shell command, approved once', () =>
    drive.evaluate(ask('Run exactly this shell command with your bash tool: echo APPROVED-RUN > approved.txt   Then reply with one sentence saying whether it ran.', 'approve')))
  const inWorkspace = existsSync(join(workspace, 'approved.txt'))
  const inAppFolder = existsSync(join(drive.profile, 'approved.txt'))
  await drive.capture('where the approved command wrote its file', () =>
    `in the workspace: ${inWorkspace ? 'PRESENT' : 'ABSENT'} · where the app stands: ${inAppFolder ? 'PRESENT' : 'ABSENT'}`)
  say(`  [${inWorkspace && !inAppFolder ? 'PASS' : 'FAIL'}] the approved command ran IN the workspace, not where the app stands`)
  await drive.capture('a shell command, declined', () =>
    drive.evaluate(ask('Run exactly this shell command with your bash tool: echo DENIED-RUN > denied.txt   If it is declined, do not try another way; say so in one sentence.', 'deny')))
  await drive.capture('the file the declined command would have written', () => `denied.txt: ${existsSync(join(workspace, 'denied.txt')) ? 'PRESENT' : 'ABSENT'}`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on OpenCode / ${MODEL}, Approve each action, the app launched outside the workspace; one shell command approved once, one declined.` })
}
