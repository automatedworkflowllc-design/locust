// Does the check card survive a restart? (A3.3, after 0.347)
//
//   LOCUST_SPEND=1 node _tools/drive-check-after-restart.mjs [--packaged <exe>] [--tag <label>]
//
// 0.347 held the card only in the window: a conversation reopened after the
// app was closed came back without it, and without its Send button. The same
// scratch project as drive-check-after-edits (check.js fails when notes.txt
// says BROKEN): the check is set, Wren (Claude Haiku) writes BROKEN, the card
// is read; the app is closed and opened again on the same profile, the
// conversation is opened from the sidebar, and the card is read again.
//
// SPENDS: one short Claude Haiku turn.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { conversationRows, git, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `check-after-restart-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Haiku turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-check-restart-ws-')
await writeFile(join(workspace, 'notes.txt'), 'fine\n', 'utf8')
await writeFile(join(workspace, 'check.js'), [
  "const text = require('fs').readFileSync('notes.txt', 'utf8')",
  "if (text.includes('BROKEN')) { console.log('FAIL: notes.txt says BROKEN'); process.exit(1) }",
  "console.log('ok')"
].join('\n') + '\n', 'utf8')
await git(['add', '-A'], workspace)
await git(['commit', '-q', '-m', 'check'], workspace)

const intro = `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. check.js fails when notes.txt says BROKEN; Wren on Claude Haiku, Edit; the app closed and opened again between.`
const CARD = `(async () => {
  for (let i = 0; i < 60; i += 1) {
    const cards = [...document.querySelectorAll('.lc-editcheck')]
    if (cards.length > 0) return cards.map((c) => c.innerText.split(/\\s+/).join(' ')).join(' ;; ')
    await new Promise((r) => setTimeout(r, 500))
  }
  return 'NO CHECK CARD'
})()`

let drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'check-after-restart',
  port: 9326,
  workspace,
  spends: true,
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let handoff
try {
  await drive.capture('Settings: set the check for this folder', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      document.querySelector('button[title="Settings (Ctrl 3)"]').click()
      await new Promise((r) => setTimeout(r, 900))
      const input = document.querySelector('input[aria-label="Check after edits"]')
      if (!input) return 'NO CHECK AFTER EDITS ROW'
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'node check.js')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      input.closest('form').requestSubmit()
      await new Promise((r) => setTimeout(r, 900))
      return 'saved: ' + input.value
    })()`)
  })
  await drive.capture('Wren writes BROKEN; the card before the restart', async () => {
    await drive.evaluate(openTeammateScript('Wren'))
    await drive.evaluate(sendAndWaitScript('Replace the whole contents of notes.txt with the single word BROKEN. Do nothing else and do not run any commands.', { waitSeconds: 180 }))
    return drive.evaluate(CARD)
  })
  handoff = await drive.finish({ intro, last: false })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (handoff !== undefined) {
  try {
    // The same profile, opened again. No seed: it would overwrite the
    // settings the first half saved.
    drive = await startDrive({
      ...(packaged === undefined ? {} : { packaged }),
      name: 'check-after-restart',
      port: 9326,
      workspace,
      profilePath: handoff.profile,
      outPath: handoff.out,
      stepFrom: handoff.step
    })
    await drive.capture('opened again: the conversation from the sidebar, and its card', async () => {
      await drive.ready()
      const opened = await drive.evaluate(`(async () => {
        for (let i = 0; i < 40; i += 1) {
          const rows = ${conversationRows()}
          if (rows.length > 0) { rows[0].click(); return 'opened: ' + rows[0].title }
          await new Promise((r) => setTimeout(r, 250))
        }
        return 'NO CONVERSATION ROW'
      })()`)
      const card = await drive.evaluate(CARD)
      const send = await drive.evaluate(`String([...document.querySelectorAll('.lc-editcheck button')].some((b) => /^Send to /.test(b.innerText.trim())))`)
      return `${String(opened)} || ${String(card)} || send button: ${String(send)}`
    })
  } catch (error) {
    say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro })
  }
}
