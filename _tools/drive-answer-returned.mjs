// An answer not written back is brought back (A2.1).
//
//   node _tools/drive-answer-returned.mjs [--packaged <exe>] [--tag <name>]
//
// Wren asks Booty a question with a share block -- and the question itself
// tells Booty to answer in plain text, with no block back. That is the case
// Colin hit on 2026-09-05 ("wren answered it but only in his own chat, we
// never got the reply in booty's chat"), made to happen on purpose. When
// Booty's run ends, the host must bring the answer to Wren: a message from
// Booty labelled as returned, and a turn of Wren's to take it.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace, teammateRows, recordRoot } from './drive-lib.mjs'

/*
 * Free by default. LOCUST_DRIVE_CLAUDE=1 runs the teammates on Claude Haiku
 * instead -- for when the OpenCode free tier is down (2026-09-24) -- and says
 * the drive spends, so it also needs LOCUST_SPEND=1.
 */
const ON_CLAUDE = process.env.LOCUST_DRIVE_CLAUDE === '1'
const ROUTE = ON_CLAUDE ? { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } : FREE_ROUTE

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `answer-returned-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-returned-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'answer-returned',
  port: 9537,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off' }
  }
})

const busy = `${teammateRows()}.some(r => /working|running|starting|replying|listening|thinking|waiting/i.test(r.innerText))`

try {
  await drive.capture('launch: two teammates, replies on', () => drive.ready())
  await drive.capture('Wren is asked to put a question to Booty', () => drive.evaluate(`(async () => {
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, message: u.message, teammateId: u.teammateId, startedBy: u.startedBy }) })
    // Assigned, not called at the start of a line: a line opening with "["
    // continues the one above it, which is the SyntaxError the first run hit.
    const wren = ${teammateFace('Wren')}
    wren.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Send your teammate Booty one message with the share block form. The message must say exactly: "Answer in your own reply as plain text, with no share block back to me: what is 17 times 3?" Do not read or edit any files, and do nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture('wait for the whole exchange to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 900; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 30 && !document.querySelector('button[aria-label^="Stop the running"]') && !${busy}) return 'settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))
  {
    await writeFile(join(drive.out, 'host-updates.json'), String(await drive.evaluate(`JSON.stringify(window.__updates ?? [], null, 2)`)), 'utf8')
  }
  await drive.capture('what the host said, and who started which run', () => drive.evaluate(`(() => {
    const notices = (window.__updates ?? []).filter(u => u.kind === 'relay-notice').map(u => u.message)
    const starts = (window.__updates ?? []).filter(u => u.kind === 'mission-started').map(u => (u.teammateId ?? 'nobody') + (u.startedBy ? ' (' + u.startedBy.kind + ')' : ''))
    return 'notices: ' + notices.join(' / ') + ' || runs started: ' + starts.join(', ')
  })()`))
  await drive.capture("Wren's thread: Booty's answer, brought back", () => drive.evaluate(`(async () => {
    const row = ${teammateRows()}.find(r => /Wren/.test(r.innerText))
    const conversation = row && row.conversation
    if (conversation) conversation.click()
    await new Promise(r => setTimeout(r, 900))
    for (const toggle of document.querySelectorAll('.lc-peer:not(.is-open) .lc-peer__toggle')) toggle.click()
    await new Promise(r => setTimeout(r, 400))
    const messages = [...document.querySelectorAll('.lc-peer__message')].map(m => (m.closest('.lc-peer')?.querySelector('.lc-peer__toggle')?.innerText.replace(/\\s+/g, ' ').trim() ?? '?') + ': ' + (m.querySelector('.lc-peer__bubble')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? ''))
    const thread = document.querySelector('.lc-thread')?.innerText ?? ''
    return messages.join(' | ') + ' || returned label seen: ' + /Returned by Locust/.test(thread) + ' || 51 seen: ' + /\\b51\\b/.test(thread)
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Booty on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}; replies on, budget 2.` })
}
