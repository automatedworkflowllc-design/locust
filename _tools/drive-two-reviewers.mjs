// Two reviewers on different coding agents, from one click (A3.1).
//
//   LOCUST_SPEND=1 node _tools/drive-two-reviewers.mjs [--packaged <exe>] [--tag <label>]
//
// Wren (the free Ling) makes a small change. Booty is on Claude Haiku and
// Vale on Codex luna. More actions should offer "Ask Booty (Claude Code) and
// Vale (Codex CLI) for a review"; choosing it should start both reviews,
// each in the reviewer's own conversation, each opening with a verdict --
// Ready, Needs changes, or Start over -- as the reviewer contract asks.
//
// SPENDS: one free turn, one Claude Haiku turn, one short Codex turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { conversationRows, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateRows, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `two-reviewers-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Haiku turn and a Codex turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-two-reviewers-ws-')
const T0 = '2026-09-25T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'two-reviewers',
  port: 9320,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', mode: 'accept-edits' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: { runtime: 'claude', model: 'haiku', mode: 'ask' } },
      { teammateId: 'tm_vale', name: 'Vale', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask', effort: 'low' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('Wren makes a small change', async () => {
    await drive.ready()
    const opened = await drive.evaluate(openTeammateScript('Wren'))
    if (!opened.startsWith('opened')) return opened
    return drive.evaluate(sendAndWaitScript('Create a file named notes.txt containing the single line: hello. Then reply with the single word DONE.', { waitSeconds: 240 }))
  })
  await drive.capture('More actions: the two-reviewer entry', () => drive.evaluate(`(async () => {
    const more = document.querySelector('button[aria-label="More actions"]')
    if (!more) return 'no More actions button'
    more.click()
    await new Promise((r) => setTimeout(r, 500))
    const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]
    const menu = items.map((b) => b.innerText.split(/\\s+/).join(' ').trim()).join(' / ')
    const pair = items.find((b) => /^Ask \\S+ \\(.+\\) and \\S+ \\(.+\\) for a review$/.test(b.innerText.trim()))
    if (!pair) return 'NOT OFFERED: ' + menu
    const said = pair.innerText.trim()
    pair.click()
    return 'chose: ' + said + ' || menu: ' + menu
  })()`))
  await drive.capture('both reviews, each in its reviewer’s conversation', () => drive.evaluate(`(async () => {
    const busy = () => ${teammateRows()}.some((one) => !/idle|done/.test(one.activity))
    for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 500)); if (busy()) break }
    let quiet = 0
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      quiet = busy() ? 0 : quiet + 1
      if (quiet >= 10) break
    }
    const said = []
    for (const who of ['tm_booty', 'tm_vale']) {
      const rows = ${conversationRows()}.filter((one) => one.owner === who)
      if (rows.length === 0) { said.push(who + ': no conversation'); continue }
      rows[0].click()
      await new Promise((r) => setTimeout(r, 900))
      const header = (document.querySelector('.lc-workroom__header')?.innerText ?? '').split(/\\s+/).join(' ').slice(0, 90)
      const replies = [...document.querySelectorAll('.lc-thread .lc-message--assistant, .lc-thread .lc-msg--teammate, .lc-thread [data-role=assistant]')]
      const last = (replies.at(-1)?.innerText ?? (document.querySelector('.lc-thread')?.innerText ?? '').slice(-300)).split(/\\s+/).join(' ')
      const verdict = /\\b(Ready|Needs changes|Start over)\\b/.exec(last)?.[1] ?? 'NO VERDICT'
      said.push(who + ' [' + header + '] verdict: ' + verdict + ' -- ' + last.slice(0, 160))
    }
    return said.join(' || ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on the free Ling makes a change; Booty (Claude Haiku) and Vale (Codex luna, low) are the team's reviewers.` })
}
