// Your skills, round trip (0.679): Settings > Teammates says your own Claude
// Code skills are not lent by default, the switch lends them, the profile
// keeps it, and after a relaunch it still says so -- then off again.
//
//   node _tools/drive-your-skills-switch.mjs [--packaged <exe>]
//
// Costs nothing: no run is started.

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('your-skills-switch-2026-10-06'), tag)
await mkdir(OUT, { recursive: true })
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-06T01:00:00.000Z', route: FREE_ROUTE }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
}
const workspace = await scratchRepository('locust-drive-skills-switch-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const openRow = `(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]').click()
  await new Promise((r) => setTimeout(r, 900))
  ;[...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Teammates'))?.click()
  await new Promise((r) => setTimeout(r, 900))
  const row = document.querySelector('[data-setting="claude-skills"]')
  row?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({
    row: row !== null,
    heading: row?.querySelector('.lc-settings__heading')?.innerText ?? '',
    lede: row?.querySelector('.lc-settings__lede')?.innerText ?? '',
    on: row?.querySelector('[role=switch]')?.getAttribute('aria-checked') ?? ''
  })
})()`
const flip = `(async () => {
  document.querySelector('[data-setting="claude-skills"] [role=switch]')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const row = document.querySelector('[data-setting="claude-skills"]')
  return JSON.stringify({ lede: row?.querySelector('.lc-settings__lede')?.innerText ?? '', on: row?.querySelector('[role=switch]')?.getAttribute('aria-checked') ?? '' })
})()`
const stored = async (profile) => JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).settings?.claudeOwnSkills

let drive = await startDrive({ name: `your-skills-switch-${tag}`, port: 9887, workspace, outPath: OUT, keep: true, seed, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
try {
  await drive.ready()
  await drive.resize(1200, 820)
  const row = JSON.parse(String(await drive.capture('Settings > Teammates: Your skills, not lent', () => drive.evaluate(openRow))))
  check('Settings > Teammates has Your skills, off, saying they are not lent', row.row && row.heading === 'Your skills' && row.on === 'false' && /^Not lent/.test(row.lede), JSON.stringify(row))
  const on = JSON.parse(String(await drive.capture('Lent', () => drive.evaluate(flip))))
  check('the switch lends them and says so', on.on === 'true' && /^Lent/.test(on.lede), JSON.stringify(on))
  check('the profile keeps it', (await stored(profilePath)) === true, String(await stored(profilePath)))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. Your skills, lent.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `your-skills-switch-${tag}-again`, port: 9887, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 3, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1200, 820)
  const row = JSON.parse(String(await drive.capture('After a relaunch: still lent', () => drive.evaluate(openRow))))
  check('after a relaunch it still says Lent', row.on === 'true' && /^Lent/.test(row.lede), JSON.stringify(row))
  const off = JSON.parse(String(await drive.capture('Not lent again', () => drive.evaluate(flip))))
  check('off again', off.on === 'false' && /^Not lent/.test(off.lede) && (await stored(profilePath)) === false, JSON.stringify(off))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
