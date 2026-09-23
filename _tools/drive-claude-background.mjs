// What does a Claude command row say when its background work is stopped?
//
//   LOCUST_SPEND=1 LOCUST_DRIVE_LOCAL=1 node _tools/drive-claude-background.mjs
//
// MEASURED 2026-09-22 outside the app: Claude Code in print mode kills its
// background work when the run ends, and says so after its result
// (`task_notification`, status `stopped`). This drives the same thing through
// the app and reads the row back: the command's description, the result
// badge, what became of the work -- and whether the file the command would
// have written ever appears.
//
// The person ASKS for the background here, on purpose. The briefing now tells
// every teammate that its run ends with its answer and to wait for what it
// needs; an explicit ask from the person should still win, and this shows
// whether it does.
//
// Spends one Claude Code turn on HAIKU, and refuses to send on anything else
// (Colin, 2026-09-22: Claude and Codex are allowed for testing, cheap models
// only).

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-claude-bg-ws-')
const drive = await startDrive({
  name: 'claude-background',
  port: 9331,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const chip = () => drive.evaluate(`(() => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  return control ? control.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

try {
  await drive.capture('Wren on Claude Code / haiku', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  })

  // The route is asserted BEFORE anything is sent. A drive that logs the
  // wrong route and sends anyway spends first and notices second.
  const route = await chip()
  if (!/haiku/i.test(route)) {
    say(`refusing to send: the composer is on "${route}", not Haiku.`)
    throw new Error('wrong route')
  }
  say(`route: ${route}`)

  await drive.capture('ask for it in the background, and settle', () =>
    drive.evaluate(sendAndWaitScript(
      'Run this command in the background (Bash with run_in_background set to true) and reply right away without waiting for it: sleep 8 && echo finished > out.txt',
      { waitSeconds: 240 }
    ))
  )

  await drive.capture('the command row, read back', () => drive.evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.lc-filerow.is-shell')]
    const last = rows.at(-1)
    last?.scrollIntoView({ block: 'center' })
    await new Promise(r => setTimeout(r, 300))
    return JSON.stringify(rows.map((row) => ({
      text: row.innerText.replace(/\\s+/g, ' ').trim(),
      badges: [...row.querySelectorAll('.lc-shellbadge')].map((b) => b.className.replace('lc-shellbadge', '').trim() + ':' + b.innerText.trim()),
      hover: row.querySelector('.lc-shellbadge.is-background')?.getAttribute('title') ?? null,
      opens: row.tagName === 'BUTTON',
      sweeping: row.querySelector('.lc-sweep') !== null
    })))
  })()`))

  // Long enough for the command to have finished if it had been left to.
  await new Promise((resolve) => setTimeout(resolve, 12_000))
  say(`out.txt exists 12s later: ${String(existsSync(join(workspace, 'out.txt')))}`)

  await drive.capture('opened: the command under the description', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('button.lc-filerow.is-shell')].at(-1)
    if (!row) return 'no openable command row'
    row.click()
    await new Promise(r => setTimeout(r, 400))
    row.scrollIntoView({ block: 'center' })
    return 'command shown: ' + (document.querySelector('.lc-shellcommand')?.innerText ?? '(none)')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One Claude Code turn on Haiku, asked to background a command and reply.' })
}
