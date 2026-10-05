// The person's check after a teammate's edits (A3.3).
//
//   LOCUST_SPEND=1 node _tools/drive-check-after-edits.mjs [--packaged <exe>] [--tag <label>]
//
// Colin, 2026-09-25: "ill run with your recommendations" -- a check command
// set in Settings for this folder (never read from the project), run after a
// turn that changed files; only what is new since the last check is shown,
// with a button to send it back. A scratch project whose check fails when
// notes.txt says BROKEN: the command is set through the Settings row, Wren
// (Claude Haiku) is asked to write BROKEN, the card should name the failure
// and offer "Send to Wren", and after Send the next check should pass.
//
// SPENDS: two short Claude Haiku turns.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `check-after-edits-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends Claude Haiku turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-check-ws-')
await writeFile(join(workspace, 'notes.txt'), 'fine\n', 'utf8')
await writeFile(join(workspace, 'check.js'), [
  "const text = require('fs').readFileSync('notes.txt', 'utf8')",
  "if (text.includes('BROKEN')) { console.log('FAIL: notes.txt says BROKEN'); process.exit(1) }",
  "console.log('ok')"
].join('\n') + '\n', 'utf8')
await git(['add', '-A'], workspace)
await git(['commit', '-q', '-m', 'check'], workspace)

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'check-after-edits',
  port: 9324,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const CARD = `(async () => {
  for (let i = 0; i < 120; i += 1) {
    const cards = [...document.querySelectorAll('.lc-editcheck')]
    if (cards.length > 0) return cards.map((c) => c.innerText.split(/\\s+/).join(' ')).join(' ;; ')
    await new Promise((r) => setTimeout(r, 500))
  }
  return 'NO CHECK CARD'
})()`

try {
  await drive.capture('Settings: set the check for this folder', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      document.querySelector('button[title="Settings (Ctrl 3)"]').click()
      await new Promise((r) => setTimeout(r, 900))
      // Check after edits is on the Project folder page in Settings (settingsPages.ts).
      ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'Project folder')?.click()
      await new Promise((r) => setTimeout(r, 900))
      const input = document.querySelector('input[aria-label="Check after edits"]')
      if (!input) return 'NO CHECK AFTER EDITS ROW'
      input.scrollIntoView({ block: 'center' })
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'node check.js')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      input.closest('form').requestSubmit()
      await new Promise((r) => setTimeout(r, 900))
      return 'saved: ' + input.value + ' || row: ' + input.closest('.lc-policyrow').innerText.split(/\\s+/).join(' ').slice(0, 120)
    })()`)
  })
  await drive.capture('Wren writes BROKEN into notes.txt', async () => {
    await drive.evaluate(openTeammateScript('Wren'))
    await drive.evaluate(sendAndWaitScript('Replace the whole contents of notes.txt with the single word BROKEN. Do nothing else and do not run any commands.', { waitSeconds: 180 }))
    return drive.evaluate(CARD)
  })
  await drive.capture('Send to Wren, and the check after that turn', async () => {
    const pressed = await drive.evaluate(`(async () => {
      const send = [...document.querySelectorAll('.lc-editcheck button')].find((b) => /^Send to /.test(b.innerText.trim()))
      if (!send) return 'NO SEND BUTTON'
      const said = send.innerText.trim()
      send.click()
      return 'pressed: ' + said
    })()`)
    if (!pressed.startsWith('pressed')) return pressed
    await sleep(3000)
    await drive.evaluate(`(async () => {
      for (let i = 0; i < 360; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        // A teammate may still ask to run something; this drive approves it.
        const approve = [...document.querySelectorAll('[role=group][aria-label="Approval required"] button')].find((b) => /^Approve once/.test(b.innerText.trim()))
        if (approve) { approve.click(); await new Promise((r) => setTimeout(r, 900)); continue }
        if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
    })()`)
    await sleep(1500)
    return `${pressed} || ${await drive.evaluate(CARD)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A scratch project whose check.js fails when notes.txt says BROKEN; Wren on Claude Haiku, Edit.` })
}
