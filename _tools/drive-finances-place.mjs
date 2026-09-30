// The Finances place (0.501): switched on in Settings, opened from the sidebar, asked about a statement.
//
//   LOCUST_SPEND=1 node _tools/drive-finances-place.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: a tester "really feels connected" to Codex's Finances --
// "mirror it for people that tick it on in settings and then it could appear
// in sidebar". Off, there is no Finances in the sidebar. Switched on in
// Settings > Connectors, it appears; opened, the window is in the place's own
// folder with its teammate on Codex in Ask and three starters. A made-up
// statement is dropped in and one question asked: the answer must carry the
// right category and total, and the statement must be exactly as it was --
// Ask cannot change it. The place lives in a scratch folder
// (LOCUST_PLACES_ROOT), never the person's real one. Spends one Codex turn.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const places = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-places-'))
const workspace = await scratchRepository('locust-drive-finances-ws-')
// A made-up month: groceries are the biggest category, at 312.40.
const STATEMENT = [
  'date,description,category,amount',
  '2026-09-02,FRESH MARKET,Groceries,-84.15',
  '2026-09-05,CITY POWER,Utilities,-96.00',
  '2026-09-09,FRESH MARKET,Groceries,-121.30',
  '2026-09-12,STREAMFLIX,Subscriptions,-15.99',
  '2026-09-14,CORNER CAFE,Dining,-22.40',
  '2026-09-19,FRESH MARKET,Groceries,-106.95',
  '2026-09-21,GYMCO,Subscriptions,-39.00',
  '2026-09-27,PAYROLL,Income,2400.00',
  ''
].join('\n')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `finances-place-${tag}`,
  port: 9803,
  workspace,
  spends: true,
  env: { LOCUST_PLACES_ROOT: places },
  outPath: join(recordRoot('finances-place-2026-09-30'), tag),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 240)}`}`)
}
const sidebarHasFinances = `!![...document.querySelectorAll('.lc-sidebar__places button')].find((b) => /Finances/.test(b.innerText))`

try {
  await drive.capture('launch', () => drive.ready())
  check('off, there is no Finances in the sidebar', (await drive.evaluate(sidebarHasFinances)) === false)

  const switched = JSON.parse(String(await drive.capture('Settings > Connectors: Finances switched on', () => drive.evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')
    open?.click()
    await new Promise((r) => setTimeout(r, 700))
    const page = [...document.querySelectorAll('.lc-settings__navitem')].find((b) => /Connectors/.test(b.innerText))
    page?.click()
    await new Promise((r) => setTimeout(r, 500))
    const toggle = document.querySelector('button[role="switch"][aria-label="Finances"]')
    if (!toggle) return JSON.stringify({ found: false })
    toggle.click()
    await new Promise((r) => setTimeout(r, 900))
    return JSON.stringify({ found: true, on: toggle.getAttribute('aria-checked'), lede: toggle.closest('.lc-settingline')?.innerText.replace(/\\s+/g, ' ').trim() })
  })()`))))
  check('Settings > Connectors has a Finances switch, and it turns on', switched.found && switched.on === 'true', JSON.stringify(switched))
  check('switched on, Finances is in the sidebar', (await drive.evaluate(sidebarHasFinances)) === true)

  const opened = JSON.parse(String(await drive.capture('Finances opened from the sidebar', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__places button')].find((b) => /Finances/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 2500))
    return JSON.stringify({
      placeholder: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? '',
      route: document.querySelector('form.command-dock .lc-control__model')?.closest('.lc-control')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      folder: document.querySelector('form.command-dock .lc-control--folder, form.command-dock [aria-label*="folder" i]')?.innerText.trim() ?? '',
      starters: [...document.querySelectorAll('.lc-starter, .lc-starters button, .lc-home__starter')].map((b) => b.innerText.trim()).slice(0, 3),
      body: document.querySelector('.lc-thread, main')?.innerText.replace(/\\s+/g, ' ').slice(0, 400) ?? ''
    })
  })()`))))
  check('it opens on the Finances teammate', /Message Finances/.test(opened.placeholder), opened.placeholder)
  check('on Codex', /Codex/.test(opened.route), opened.route)
  check('with starters about money', /money|subscriptions|month/i.test(opened.body), opened.body)
  const note = await readFile(join(places, 'finances', 'README.md'), 'utf8').catch(() => '')
  check('its folder was made, with a note saying what it is for', /Finances place in Locust/.test(note))

  await writeFile(join(places, 'finances', 'september.csv'), STATEMENT, 'utf8')
  const answer = String(await drive.capture('asked about the statement', () => drive.evaluate(sendAndWaitScript('Look at september.csv. What did I spend the most on in September? Reply with the category and its total only.', { waitSeconds: 300 }))))
  check('the answer names the biggest category and its total', /Groceries/i.test(answer) && /312\.40/.test(answer), answer.slice(-200))
  const after = await readFile(join(places, 'finances', 'september.csv'), 'utf8')
  check('the statement is exactly as it was: Ask changed nothing', after === STATEMENT)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The Finances place, in ${places}.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
