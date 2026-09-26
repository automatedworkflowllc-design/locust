// Does a review of a LONG turn start, and open with a verdict (A5.2, A3.2)?
//
//   LOCUST_SPEND=1 node _tools/drive-review-long-turn.mjs [--packaged <exe>] [--tag <name>]
//
// Wren, on Claude Haiku in Ask mode, writes a long answer -- about 8,000
// characters, the size that made the review brief longer than a mission
// prompt may be, so "Ask Ash for a review" was refused before it started.
// Then the review is asked for the way a person asks, from More actions. It
// must start as Ash's run, and Ash's answer must open with a verdict. Two
// Haiku turns, one of them long.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `review-long-turn-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
const drive = await startDrive({
  spends: true,
  name: 'review-long-turn',
  port: 9541,
  workspace: await scratchRepository('locust-drive-review-long-ws-'),
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

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  const long = await drive.capture('Wren writes a long answer', async () => {
    const opened = await drive.evaluate(openTeammateScript('Wren'))
    if (!opened.startsWith('opened')) return opened
    await drive.evaluate(sendAndWaitScript('Write exactly 90 numbered lines, each at least 90 characters long, each a different true fact about the history of computing. Do not use any tools, and write nothing before or after the list.'))
    return drive.evaluate(`String([...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.innerText).join('').length)`)
  })
  say(`Wren's answer on screen: ${String(long)} characters`)
  const asked = String(await drive.capture('More actions: "Ask Ash for a review"', () => drive.evaluate(`(async () => {
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, teammateId: u.teammateId }) })
    const more = document.querySelector('button[aria-label="More actions"]')
    if (!more) return 'no More actions button'
    more.click()
    await new Promise(r => setTimeout(r, 500))
    const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]
    const ask = items.find(b => /Ask Ash for a review/.test(b.innerText))
    if (!ask) return 'not offered: ' + items.map(b => b.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
    ask.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'running'
    }
    // Not running: say what the window said instead.
    const said = [...document.querySelectorAll('[role=alert], .lc-toast, .lc-notice, .lc-thread .lc-diagnostic')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' / ')
    return 'not running: ' + said.slice(0, 300)
  })()`)))
  say(`asked: ${asked}`)
  const verdict = String(await drive.capture("Ash's review, when it is done", () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1200))
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 120) ?? ''
    const said = [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((node) => node.innerText.trim()).at(-1) ?? ''
    const ashStarted = (window.__updates ?? []).some(u => u.kind === 'mission-started' && u.teammateId === 'tm_ash')
    return JSON.stringify({ header, opens: said.slice(0, 160), ashStarted })
  })()`)))
  const review = JSON.parse(verdict)
  check("Wren's answer was long enough to have been refused before", Number(long) >= 7_000, String(long))
  // The header, not an update: a start the window makes itself is answered
  // directly, and only the host's own starts (relay, room) come as updates.
  check('the review started, as Ash', asked === 'running' && /Ash/.test(review.header), `${asked} || ${review.header}`)
  check('and it opened with a verdict', /^\W*(ready|needs changes|start over)\b/i.test(review.opens), review.opens)
  say(failures === 0 ? '\nREVIEW LONG TURN PASSED' : `\nREVIEW LONG TURN: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Ash on Claude Haiku (Ask); a long answer, then its review.` })
}
