// A team shared as a picture of itself (0.398).
//
//   node _tools/drive-team-card.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing. Two launches:
//   1. Three teammates -- three roles, three runtimes, one on a model of its
//      own. Team screen, Share team, Save image: the file must be a PNG with
//      the team written into it, and the model of their own left out.
//   2. A fresh Locust with nobody in it: Add team from image, the same file.
//      The same three names, roles and models must appear on the roster.
// The two file dialogs are answered by LOCUST_TEAM_CARD_PATH (a drive cannot
// press a native dialog); everything else is the app's own.

import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('team-card-2026-09-27'), `team-card-${tag}`)
await mkdir(OUT, { recursive: true })
const CARD = join(await mkdtemp(join(tmpdir(), 'locust-team-card-')), 'Locust team.png')
const T0 = '2026-09-27T05:00:00.000Z'
const TEAM = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { runtime: 'claude', model: 'opus', mode: 'accept-edits' } },
  { teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: T0, route: { runtime: 'codex', model: 'gpt-5.5-codex', mode: 'ask' } },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Custom', roleTitle: 'Release captain', createdAt: T0, route: { runtime: 'opencode', model: 'own-1a2b3c4d/acme-70b', mode: 'accept-edits' } }
]

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const openTeam = (drive) => drive.evaluate(`(async () => {
  document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 900))
  return document.querySelector('.lc-screen__title')?.textContent ?? ''
})()`)
const press = (drive, label) => drive.evaluate(`(async () => {
  const button = [...document.querySelectorAll('button')].find((entry) => entry.innerText.trim() === ${JSON.stringify(label)})
  if (!button) return 'no ' + ${JSON.stringify(label)}
  button.click()
  await new Promise((r) => setTimeout(r, 1500))
  return 'pressed'
})()`)
const teamCardChunk = (png) => {
  let at = 8
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('latin1')
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'tEXt' && data.subarray(0, data.indexOf(0)).toString('latin1') === 'locust-team') {
      return JSON.parse(Buffer.from(data.subarray(data.indexOf(0) + 1).toString('latin1'), 'base64').toString('utf8'))
    }
    at += 12 + length
  }
  return undefined
}

// 1. Share.
{
  const drive = await startDrive({
    name: `team-card-share-${tag}`, port: 9705, workspace: await scratchRepository('locust-team-card-ws-'), outPath: join(OUT, 'share'),
    sendsNothing: true, env: { LOCUST_TEAM_CARD_PATH: CARD }, ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: TEAM, missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
  })
  try {
    await drive.ready()
    await drive.resize(1440, 900)
    check('the Team screen is open', String(await openTeam(drive)) === 'Team')
    check('Share team opens the card', String(await drive.capture('Share team: the card', () => press(drive, 'Share team'))) === 'pressed')
    const shown = String(await drive.evaluate(`document.querySelector('.lc-teamcard')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
    check('the card shows every face, name and role', ['Wren', 'Sable', 'Juno', 'Code & Migrations', 'Data & Reporting', 'Release captain'].every((word) => shown.includes(word)), shown.slice(0, 200))
    await drive.capture('Save image', () => press(drive, 'Save image'))
    const said = String(await drive.evaluate(`document.querySelector('.lc-shareteam__said')?.textContent ?? ''`))
    check('it says where the image went', said.includes('Saved to'), said)
    const png = await readFile(CARD)
    const card = teamCardChunk(png)
    check('the file is a PNG that carries the team', png.subarray(1, 4).toString() === 'PNG' && card?.teammates?.length === 3, JSON.stringify(card).slice(0, 200))
    check('and not the model of their own', !JSON.stringify(card).includes('own-1a2b') && card?.teammates?.[2]?.route === undefined)
  } catch (error) {
    failures += 1
    say(`share failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Three teammates, Share team, Save image to a temp file (LOCUST_TEAM_CARD_PATH).`, extra: `Checks failed so far: ${String(failures)}` })
  }
}

// 2. Add, in a Locust with nobody in it.
{
  const profile = await mkdtemp(join(tmpdir(), 'locust-drive-team-card-add-'))
  const drive = await startDrive({
    name: `team-card-add-${tag}`, port: 9707, workspace: await scratchRepository('locust-team-card-add-ws-'), outPath: join(OUT, 'add'), profilePath: profile,
    sendsNothing: true, env: { LOCUST_TEAM_CARD_PATH: CARD }, ...(packaged === undefined ? {} : { packaged }),
    seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
  })
  try {
    await drive.ready()
    await drive.resize(1440, 900)
    // Where a new person is: an empty Home. The Team screen needs a team to
    // be reached, so Home's own row offers the image (the first run of this
    // drive found no way in at all).
    await drive.capture('an empty Home offers "Team from an image"', () => press(drive, 'Team from an image'))
    await sleep(800)
    const notice = String(await drive.evaluate(`document.querySelector('.lc-teamnotice')?.textContent ?? ''`))
    check('it says who was added', /Added Wren, Sable, Juno from the team card\./.test(notice), notice)
    const roster = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).teammates
    const read = roster.map((entry) => `${entry.name}|${entry.roleTitle ?? entry.role}|${entry.route?.runtime ?? '-'}|${entry.route?.model ?? '-'}`)
    check('the same three, with their roles and models', JSON.stringify(read) === JSON.stringify(['Wren|Code & Migrations|claude|opus', 'Sable|Data & Reporting|codex|gpt-5.5-codex', 'Juno|Release captain|-|-']), JSON.stringify(read))
    await drive.capture('the team, added', () => drive.evaluate(`[...document.querySelectorAll('.lc-rostercard__name')].map((entry) => entry.textContent).join(', ')`))
  } catch (error) {
    failures += 1
    say(`add failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'A Locust with nobody in it; Add team from image, the file the first launch saved.', extra: `Checks failed: ${String(failures)}` })
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
