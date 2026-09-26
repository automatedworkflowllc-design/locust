// A new person's first two minutes, photographed (0.358).
//
//   node _tools/drive-first-session.mjs [--packaged <exe>] [--tag <name>]
//
// Locust is for "quite literally ANY ai user" (Colin, 2026-09-26), so this is
// someone who is not a coder: nobody on the team, nothing remembered. They
// start with the Research & money team, open Sable, ask a money question on
// the free model, read the answer, and look at what happened. Every screen
// is captured at 1440x900 for a person to judge. Two things it checks, both
// found by the 0.358 run of this very drive: Sable offers money questions,
// not "Summarize what this codebase is for", and the Activity panel under
// her web searches does not say the network was denied.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `first-session-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-first-session-ws-')
const drive = await startDrive({
  name: 'first-session',
  port: 9617,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  // The settings a new profile has: teammates may message each other.
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'on' } }
})
const verdicts = []

const text = (selector) => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 220)`

try {
  await drive.capture('launch: a new person, nobody on the team', () => drive.ready())
  await drive.resize(1440, 900)
  await sleep(1200)
  await drive.capture('Home, first thing', () => drive.evaluate(text('main')))
  await drive.capture('press Research & money', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-teamtemplate')].find((one) => /Research & money/.test(one.textContent))
    if (!card) return 'no Research & money card'
    card.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-hometeam:not(.lc-teamtemplates)'); i += 1) await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => setTimeout(r, 800))
    return ${text('.lc-hometeam')}
  })()`))
  await drive.capture('open Sable from Home', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((one) => /Sable/.test(one.textContent))
    if (!card) return 'no Sable card'
    card.click()
    await new Promise((r) => setTimeout(r, 1300))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
  })()`))
  const offered = await drive.evaluate(`[...document.querySelectorAll('.lc-starter')].map((one) => one.textContent).join(' | ') + ' || ' + (document.querySelector('.lc-empty__inner p')?.textContent ?? '')`)
  say(`Sable offers: ${offered}`)
  verdicts.push(`Sable offers money, not code: ${/savings/.test(offered) && !/codebase|reads this workspace/.test(offered) ? 'PASS' : 'FAIL'}`)
  const answered = await drive.capture('ask Sable a money question', () =>
    drive.evaluate(sendAndWaitScript('I have $12,000 saved and want to use it within three years. How should I think about where to keep it?', { waitSeconds: 300 }))
  )
  say(`answered: ${answered.slice(0, 160)}`)
  await drive.capture('the answer, scrolled to its end', () => drive.evaluate(`(async () => {
    const scroller = document.querySelector('.lc-thread')?.closest('[class*="scroll"]') ?? document.querySelector('.lc-thread')
    scroller?.scrollTo?.({ top: 1e9 })
    await new Promise((r) => setTimeout(r, 600))
    return ${text('.lc-thread')}
  })()`))
  await drive.capture('what happened (Activity)', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Activity')?.click()
    await new Promise((r) => setTimeout(r, 900))
    return ${text('.lc-inspector')}
  })()`))
  const panel = await drive.evaluate(`(document.querySelector('.lc-inspector')?.innerText ?? '').replace(/\\s+/g, ' ')`)
  const searched = /Searched the web/.test(panel)
  say(`panel: ${panel.slice(panel.indexOf('WHAT IT MAY DO') >= 0 ? panel.indexOf('WHAT IT MAY DO') : 0).slice(0, 400)}`)
  verdicts.push(`the panel says the web is allowed${searched ? ' (it searched)' : ' (no search this run)'}: ${/search the web and open web pages/.test(panel) && !/beyond the model's own/.test(panel) ? 'PASS' : 'FAIL'}`)
  await drive.capture('back on Home, with a team and a conversation', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-brand__lockup')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return ${text('main')}
  })()`))
  await drive.capture('the sidebar faces: Sable working, then done', () => drive.evaluate(`(async () => {
    const face = ${teammateFace('Sable')}
    return face === null || face === undefined ? 'no Sable face' : (face.getAttribute('aria-label') ?? 'Sable')
  })()`))
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A new person, nobody on the team: Research & money, then a money question to Sable on the free model. Screens for a person to judge. Verdicts: ${verdicts.join('; ')}` })
}
