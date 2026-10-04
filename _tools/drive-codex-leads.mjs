// B4 leads 1 and 11 through the app, on Codex's app-server.
//
//   LOCUST_SPEND=1 node _tools/drive-codex-leads.mjs [--packaged <exe>] [--tag <label>]
//
// Lead 11: a resumed turn's receipt took the thread's running total, so a
// one-line second turn reported the whole conversation's tokens. Lead 1: a
// sub-agent's turn runs on the same connection and ends BEFORE the parent's,
// and the first `turn/completed` ended the run. Both measured 2026-09-25 with
// probe-codex-resume-and-subagent.
//
// One conversation with Wren on gpt-5.6-luna at the lowest effort: two
// one-line turns (the header's "N in" should be about the same, not double),
// then Vale, with no history, starts a sub-agent (the parent must answer,
// after it).
//
// SPENDS: three short Codex turns and one sub-agent turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `codex-leads-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends Codex turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-codex-leads-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'codex-leads',
  port: 9319,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } },
      // The sub-agent turn goes to a teammate with no history: asked on Wren's
      // resumed thread, Codex answered that no sub-agent tool was available.
      { teammateId: 'tm_vale', name: 'Vale', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const LOWEST = `(async () => {
  const button = [...document.querySelectorAll('button.lc-control')].find((b) => b.querySelector('.lc-control__effort'))
  if (!button) return 'no effort control'
  if (!document.querySelector('.lc-effortpanel')) { button.click(); await new Promise((r) => setTimeout(r, 700)) }
  const slider = document.querySelector('.lc-effortpanel__slider')
  if (!slider) return 'no slider'
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '0')
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 500))
  const said = slider.getAttribute('aria-valuetext')
  button.click()
  await new Promise((r) => setTimeout(r, 300))
  return 'effort ' + said
})()`
const header = () => drive.evaluate(`(document.querySelector('.lc-workroom__header')?.innerText ?? '').split(/\\s+/).join(' ').slice(0, 200)`)
const inCount = (text) => {
  const match = /([\d.]+)(k?) in\b/.exec(text)
  return match === null ? undefined : Math.round(Number(match[1]) * (match[2] === 'k' ? 1000 : 1))
}

try {
  let first
  await drive.capture('Wren on Codex luna, lowest effort; turn one', async () => {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    const route = await drive.evaluate(pickRouteScript({ group: '/codex/i', search: 'luna', row: '/luna/i' }))
    if (!/luna/i.test(route)) return `NOT SENT: the route is not Codex luna -- ${route}`
    const effort = await drive.evaluate(LOWEST)
    await drive.evaluate(sendAndWaitScript('Reply with exactly: ONE', { waitSeconds: 180 }))
    const seen = await header()
    first = inCount(seen)
    return `${route} || ${effort} || header: ${seen}`
  })
  await drive.capture('turn two, the same conversation resumed', async () => {
    await drive.evaluate(sendAndWaitScript('Reply with exactly: TWO', { waitSeconds: 180 }))
    const seen = await header()
    const second = inCount(seen)
    return `header: ${seen} || in: turn one ${String(first)}, turn two ${String(second)} -- ${second !== undefined && first !== undefined && second < first * 1.6 ? 'ITS OWN' : 'LOOKS CUMULATIVE'}`
  })
  await drive.capture('Vale, a fresh conversation: a sub-agent is started', async () => {
    await drive.evaluate(openTeammateScript('Vale'))
    const route = await drive.evaluate(pickRouteScript({ group: '/codex/i', search: 'luna', row: '/luna/i' }))
    if (!/luna/i.test(route)) return `NOT SENT: the route is not Codex luna -- ${route}`
    await drive.evaluate(LOWEST)
    const said = await drive.evaluate(sendAndWaitScript('Use your tool for starting a sub-agent to start exactly one helper whose only job is to reply with the word PING. Wait for it to finish, then tell me in one line what it said.', { waitSeconds: 300 }))
    return `header: ${await header()} || ${said.slice(-260)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Codex gpt-5.6-luna, lowest effort, Ask mode; three turns in one conversation.` })
}
