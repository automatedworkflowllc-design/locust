// Settings > AI agents says what Locust can stop, agent by agent (0.617, the PRD's R9).
//
//   node _tools/drive-what-locust-can-stop.mjs [--packaged <exe>] [--tag <name>]
//
// The section between "AI agents & accounts" and "When a model hits its
// limit": seven folded rows, each a mark, a name and a tag; opened, the three
// sentences docs/WHAT-LOCUST-CAN-STOP.md holds. Looked at in three window
// sizes: no sideways scroll, every name and tag on its row's one line, and an
// opened row's labels in one column with nothing cut off. Nothing is sent.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-can-stop-ws-')
const drive = await startDrive({
  name: `what-locust-can-stop-${tag}`, port: 9797, workspace, sendsNothing: true, outPath: join(recordRoot('what-locust-can-stop-2026-10-04'), tag), ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}
const OPEN = `(async () => {
  ;[...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')?.click()
  await new Promise((r) => setTimeout(r, 700))
  ;[...document.querySelectorAll('.lc-settings__navitem')].find((b) => /AI agents/.test(b.innerText))?.click()
  for (let i = 0; i < 40 && !document.querySelector('.lc-stops__row'); i += 1) await new Promise((r) => setTimeout(r, 250))
  const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'What Locust can stop')
  heading?.scrollIntoView({ block: 'start' })
  await new Promise((r) => setTimeout(r, 300))
  return heading ? 'open' : 'no heading'
})()`
const MEASURE = `(() => {
  const card = document.querySelector('.lc-stops__row')?.parentElement
  const scroller = card?.closest('.lc-settings__body, .lc-settings, main') ?? document.scrollingElement
  const rows = [...document.querySelectorAll('.lc-stops__row')]
  const oneLine = rows.filter((row) => { const s = row.querySelector('.lc-stops__summary'); return s.getBoundingClientRect().height > 44 }).map((row) => row.querySelector('.lc-stops__name').innerText)
  const tagsAtEdge = rows.every((row) => { const t = row.querySelector('.lc-tag').getBoundingClientRect(); const c = card.getBoundingClientRect(); return c.right - t.right < 40 })
  const heads = [...document.querySelectorAll('.lc-settings__heading')].map((h) => h.innerText.trim())
  return { rows: rows.length, names: rows.map((row) => row.querySelector('.lc-stops__name').innerText + ' / ' + row.querySelector('.lc-tag').innerText), tallSummaries: oneLine, tagsAtEdge, sideways: document.documentElement.scrollWidth > innerWidth + 1, order: heads.slice(heads.indexOf('AI agents & accounts'), heads.indexOf('When a model hits its limit') + 1), cardWidth: Math.round(card.getBoundingClientRect().width) }
})()`
const OPEN_ROW = (name) => `(async () => {
  const row = [...document.querySelectorAll('.lc-stops__row')].find((r) => r.querySelector('.lc-stops__name').innerText === ${JSON.stringify(name)})
  row.querySelector('summary').click()
  await new Promise((r) => setTimeout(r, 300))
  row.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 200))
  const dts = [...row.querySelectorAll('dt')].map((dt) => Math.round(dt.getBoundingClientRect().left))
  const dds = [...row.querySelectorAll('dd')]
  return { open: row.open, labels: [...row.querySelectorAll('dt')].map((dt) => dt.innerText), oneColumn: new Set(dts).size === 1, clipped: dds.filter((dd) => dd.scrollWidth > dd.clientWidth + 1).length, text: row.innerText.slice(0, 600) }
})()`

try {
  await drive.ready()
  await drive.send('Page.bringToFront')
  await drive.resize(1200, 720)
  check('Settings > AI agents opens at the section', String(await drive.evaluate(OPEN)) === 'open')
  for (const [width, height] of [[1000, 680], [1200, 720], [1600, 1000]]) {
    await drive.resize(width, height)
    await sleep(500)
    await drive.evaluate(`[...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'What Locust can stop')?.scrollIntoView({ block: 'start' })`)
    await sleep(300)
    const measured = await drive.capture(`the section at ${String(width)}x${String(height)}`, () => drive.evaluate(MEASURE))
    check(`${String(width)}x${String(height)}: seven rows between the two sections, one line each, tags at the edge, no sideways scroll`,
      measured.rows === 7 && measured.tallSummaries.length === 0 && measured.tagsAtEdge && !measured.sideways && measured.order.join(' > ') === 'AI agents & accounts > What Locust can stop > When a model hits its limit', JSON.stringify(measured))
  }
  await drive.resize(1200, 720)
  await sleep(400)
  const claude = await drive.capture('Claude Code, opened', () => drive.evaluate(OPEN_ROW('Claude Code')))
  check('an opened row shows its three facts in one column, nothing cut off', claude.open && claude.labels.join(',') === 'Asks first,Without asking,Always' && claude.oneColumn && claude.clipped === 0, JSON.stringify(claude))
  const cursor = await drive.capture('Cursor Agent, opened', () => drive.evaluate(OPEN_ROW('Cursor Agent')))
  check('a row with no Always says none', cursor.open && cursor.labels.join(',') === 'Asks first,Without asking', JSON.stringify(cursor))
  await drive.resize(1000, 680)
  await sleep(400)
  await drive.capture('both open at 1000x680', () => drive.evaluate(MEASURE))
  check('no renderer errors, beyond Electron\'s launch line', drive.record.flatMap((entry) => entry.errors.map(String)).filter((line) => !/^Electron sandboxed_renderer\.bundle\.js script failed to run|^console\.error$/.test(line.trim())).length === 0)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settings > AI agents, What Locust can stop, at three sizes; two rows opened.`, extra: `Checks failed: ${String(failures)}` })
  say(failures === 0 ? 'WHAT LOCUST CAN STOP: PASSED' : `WHAT LOCUST CAN STOP: FAILED (${String(failures)})`)
  process.exitCode = failures === 0 ? 0 : 1
}
