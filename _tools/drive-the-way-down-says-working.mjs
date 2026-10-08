// The way-down pill wears the thinking dots while a run is still working (0.703).
//
//   LOCUST_SPEND=1 node _tools/drive-the-way-down-says-working.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 10/08, with a picture of Claude's app: scrolled up to read while the
// teammate works, the scroll-down button shows thinking dots. One free-model
// turn: while it runs, the thread is grown and moved up as a person moves it;
// the pill must be there with the dots and say "Still working". After the run
// ends, the same pill is the plain chevron. Spends nothing (free model).
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `the-way-down-says-working-${tag}`,
  port: 9902,
  workspace: await scratchRepository('locust-drive-waydown-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  outPath: join(recordRoot('the-way-down-says-working-2026-10-08'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-08T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const PILL = `(() => {
  const pill = document.querySelector('.lc-jumpdown')
  const dots = pill?.querySelector('.lc-jumpdown__dots')
  const chevron = pill?.querySelector('.lc-jumpdown__chevron')
  return JSON.stringify({
    pill: pill !== null && pill !== undefined,
    working: pill?.classList.contains('lc-jumpdown--working') ?? false,
    dotsShown: dots ? getComputedStyle(dots).display !== 'none' : false,
    chevronShown: chevron ? getComputedStyle(chevron).display !== 'none' : false,
    label: pill?.getAttribute('aria-label') ?? '',
    size: pill ? [Math.round(pill.getBoundingClientRect().width), Math.round(pill.getBoundingClientRect().height)] : [0, 0],
    running: !!document.querySelector('button[aria-label^="Stop the running"]')
  })
})()`
const pill = async () => JSON.parse(await drive.evaluate(PILL))
/** Grow the thread and move it up, as a person scrolling back to read. */
const moveUp = () => drive.evaluate(`(async () => {
  const box = document.querySelector('.lc-thread')
  const column = box?.querySelector('.lc-thread__column')
  if (!column) return 'no thread column'
  if (!column.querySelector('[data-drive-grown]')) {
    const block = document.createElement('div')
    block.style.height = '1400px'
    block.setAttribute('data-drive-grown', '')
    column.prepend(block)
  }
  await new Promise((r) => setTimeout(r, 300))
  box.scrollTop = 0
  box.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }))
  await new Promise((r) => setTimeout(r, 800))
  return 'moved up'
})()`)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 700)) })()`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Write the numbers from 1 to 400, one per line, and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
  })()`)
  // Up while it runs: the pill wears the dots.
  let during
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    if (!(await pill()).running) continue
    await moveUp()
    during = await pill()
    if (during.pill && during.running) break
  }
  const shot = await drive.capture('moved up while Wren is working: the pill', () => JSON.stringify(during ?? {}))
  check('while the run works, the way-down pill shows the thinking dots, not the chevron', during?.running === true && during.pill && during.working && during.dotsShown && !during.chevronShown, shot)
  check('the pill keeps its round 30px size in a thread long enough to scroll', during?.size?.[0] === 30 && during?.size?.[1] === 30, JSON.stringify(during?.size))
  check('and says so to a screen reader', during?.label === 'Still working. Go to the newest message', during?.label)

  // After the run: the same view, the plain chevron.
  for (let i = 0; i < 240 && (await pill()).running; i += 1) await new Promise((r) => setTimeout(r, 1000))
  await moveUp()
  const after = await pill()
  await drive.capture('the run over, still up: the pill', () => JSON.stringify(after))
  check('the run over, the pill is the plain chevron', !after.running && after.pill && !after.working && after.chevronShown && after.label === 'Go to the newest message', JSON.stringify(after))
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The way-down pill while a free-model run works, and after it ends.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
