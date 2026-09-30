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
  '2026-08-12,STREAMFLIX,Subscriptions,-15.99',
  '2026-08-21,GYMCO,Subscriptions,-39.00',
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

  const dash = `JSON.stringify({
    open: !!document.querySelector('.lc-finances'),
    empty: document.querySelector('.lc-finances__empty h2')?.innerText.trim() ?? null,
    total: document.querySelector('.lc-fincard__total')?.innerText.trim() ?? null,
    categories: [...document.querySelectorAll('.lc-fincats li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
    recurring: [...document.querySelectorAll('[aria-label="Subscriptions and what is due"] .lc-finlist li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
    rows: document.querySelectorAll('.lc-fintable tbody tr').length,
    trend: document.querySelector('.lc-finances__trend')?.innerText.trim() ?? null
  })`
  const opened = JSON.parse(String(await drive.capture('Finances opened from the sidebar: the dashboard', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__places button')].find((b) => /Finances/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 2500))
    return ${dash}
  })()`))))
  check('it opens on the dashboard, asking for a statement', opened.open && /Add a statement/.test(opened.empty ?? ''), JSON.stringify(opened))
  const note = await readFile(join(places, 'finances', 'README.md'), 'utf8').catch(() => '')
  check('its folder was made, with a note saying what it is for', /Finances place in Locust/.test(note))

  await writeFile(join(places, 'finances', 'september.csv'), STATEMENT, 'utf8')
  const filled = JSON.parse(String(await drive.capture('a statement dropped in, read again', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Read the statements again"]')?.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-fincard__total'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 500))
    return ${dash}
  })()`))))
  check('the spending for September, by category, biggest first', filled.total === '$485.79' && /^Groceries \$312\.40/.test(filled.categories[0] ?? ''), JSON.stringify(filled))
  check('no comparison against a month the statements barely cover (August holds two rows)', filled.trend === null, filled.trend)
  check('what repeats is found, with its next date', filled.recurring.some((row) => /STREAMFLIX/.test(row) && /next around/.test(row)), JSON.stringify(filled.recurring))
  const table = JSON.parse(String(await drive.capture('the Transactions tab', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-finances__tabs button')].find((b) => /Transactions/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 500))
    return ${dash}
  })()`))))
  check('every transaction is listed', table.rows === 10, String(table.rows))

  const answer = String(await drive.capture('asked from the dashboard', () => drive.evaluate(`(async () => {
    const input = document.querySelector('.lc-finances__ask input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Look at september.csv. What did I spend the most on in September 2026? Reply with the category and its total only.')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('.lc-finances__ask button[type="submit"]')?.click()
    await new Promise((r) => setTimeout(r, 3000))
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise((r) => setTimeout(r, 800))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-400) ?? 'no thread'
  })()`)))
  check('Ask goes to the Finances teammate, and the answer is right', /Groceries/i.test(answer) && /312\.40/.test(answer), answer.slice(-200))
  const after = await readFile(join(places, 'finances', 'september.csv'), 'utf8')
  check('the statement is exactly as it was: Ask changed nothing', after === STATEMENT)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The Finances place, in ${places}.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
