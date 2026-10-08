// An empty Home offers a team, and one press makes it (0.354).
//
//   node _tools/drive-team-templates.mjs [--packaged <exe>] [--tag <name>]
//
// A profile with nobody on the team. Home is photographed at 1440x900 and at
// 1120x720 -- the three templates must sit three across, their faces drawn,
// with New teammate as the chat bar's chip -- then "Build software" is
// pressed and Home must show Wren, Juno and Atlas as its team, three across,
// with the same faces the template card showed.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `team-templates-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-templates-ws-')
const drive = await startDrive({
  name: 'team-templates',
  port: 9614,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

const home = `(async () => {
  document.querySelector('.lc-brand__lockup')?.click()
  for (let i = 0; i < 30 && !document.querySelector('.lc-teamtemplates, .lc-hometeam'); i += 1) await new Promise((r) => setTimeout(r, 200))
  await new Promise((r) => setTimeout(r, 700))
  const section = document.querySelector('.lc-teamtemplates') ?? document.querySelector('.lc-hometeam')
  if (!section) return 'no team section on Home'
  section.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  const cards = [...section.querySelectorAll('.lc-hometeam__card')]
  const tops = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)))]
  const faces = cards.map((card) => card.querySelectorAll('.lc-bot, svg, canvas').length)
  const chip = section.querySelector('.lc-chipbutton') !== null
  return (section.querySelector('h2')?.textContent ?? '?') + ' || ' + cards.length + ' cards in ' + tops.length + ' row(s) || faces per card: ' + faces.join(',') + ' || chip: ' + chip + ' || ' + cards.map((card) => card.innerText.replace(/\\s+/g, ' ').slice(0, 90)).join(' | ')
})()`

const verdicts = []
try {
  await drive.capture('launch: nobody on the team', () => drive.ready())
  await drive.resize(1440, 900)
  const wide = await drive.capture('Home at 1440x900: start with a team', () => drive.evaluate(home))
  verdicts.push(`offered: ${/^Start with a team \|\| 3 cards in 1 row\(s\)/.test(wide) && /chip: true/.test(wide) ? 'PASS' : 'FAIL'}`)
  await drive.resize(1120, 720)
  const compact = await drive.capture('Home at 1120x720: start with a team', () => drive.evaluate(home))
  verdicts.push(`compact: ${/3 cards in 1 row\(s\)/.test(compact) ? 'PASS' : 'FAIL'}`)
  await drive.resize(1440, 900)
  await drive.capture('press Build software', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-teamtemplate')].find((one) => /Build software/.test(one.textContent))
    if (!card) return 'no Build software card'
    card.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-hometeam:not(.lc-teamtemplates)'); i += 1) await new Promise((r) => setTimeout(r, 150))
    return document.querySelector('.lc-hometeam:not(.lc-teamtemplates)') ? 'the team is on Home' : 'no team after pressing'
  })()`))
  await sleep(600)
  const made = await drive.capture('Home: the team it made', () => drive.evaluate(home))
  verdicts.push(`made: ${/^Your team\s*\d* \|\| 3 cards in 1 row\(s\)/.test(made) && /Wren/.test(made) && /Juno/.test(made) && /Atlas/.test(made) ? 'PASS' : 'FAIL'}`)
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A profile with nobody on the team; Build software pressed. Verdicts: ${verdicts.join('; ')}` })
}
