// "Ask <reviewer> for a review" runs as the REVIEWER (H9).
//
//   node _tools/drive-review-as-reviewer.mjs [--packaged <exe>] [--tag <name>]
//
// Wren does a small piece of work. Then, from the conversation header's
// More actions, "Ask Ash for a review" -- the way a person asks. The review
// must be ASH's run: a new conversation under Ash's face, on Ash's route,
// with Wren's conversation left as it was. It used to go out as Wren -- the
// author reviewing their own work -- from a closure made before Ash was
// selected (code review H9; the probe that exercised it only read the words).

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, conversationRows, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

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
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `review-as-reviewer-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-review-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'review-as-reviewer',
  port: 9534,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

// Every conversation in the sidebar, and whose face it wears.
const rows = `(${conversationRows()}).map(r => (r.owner || 'nobody') + ': ' + r.title.slice(0, 60)).join(' | ')`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Wren does a small piece of work', async () => {
    const opened = await drive.evaluate(openTeammateScript('Wren'))
    if (!opened.startsWith('opened')) return opened
    return drive.evaluate(sendAndWaitScript('Create a file named notes.txt containing the single line: hello. Then reply with the single word DONE.'))
  })
  await drive.capture('More actions: "Ask Ash for a review"', () => drive.evaluate(`(async () => {
    const more = document.querySelector('button[aria-label="More actions"]')
    if (!more) return 'no More actions button'
    more.click()
    await new Promise(r => setTimeout(r, 500))
    const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]
    const menu = items.map(b => b.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
    const ask = items.find(b => /Ask Ash for a review/.test(b.innerText))
    if (!ask) return 'not offered: ' + menu
    ask.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'menu: ' + menu + ' || running: ' + (document.querySelector('button[aria-label^="Stop the running"]') !== null)
  })()`))
  await drive.capture('the review: whose conversation, whose route, and Wren\\u2019s left as it was', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1200))
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no header'
    return 'header: ' + header + ' || sidebar: ' + ${rows}
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Ash on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}.` })
}
