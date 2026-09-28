// Fresh-eyes area 25: someone writing or designing drafts a page and a simple design.
//
//   node _tools/drive-a-page-and-a-design.mjs [--packaged <exe>] [--tag <name>]
//
// Ada (a free model, Edit) writes about.md -- a short About page for a bakery
// -- and then index.html, a one-page site made from it. The drive checks both
// files on disk and photographs how each reads in the thread, then opens the
// page from the thread to see what Locust shows a person for a design.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const model = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('a-page-and-a-design-2026-09-28'), `a-page-and-a-design-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-design-ws-', 'Corner Shop, a neighbourhood bakery. This folder is its website.\n')
const drive = await startDrive({
  name: `design-${tag}`, port: 9757, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model, mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (button && !button.disabled) { button.click(); break }
  }
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
  }
  return 'timed out'
})()`)
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))

  const wrote = await send('Write about.md: a short About page for Corner Shop, our neighbourhood bakery, in a warm voice. A heading, two short paragraphs, and a list of three things we bake.')
  await sleep(2000)
  await drive.capture('about.md, as the thread shows it', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-600) ?? ''`))
  const about = await readFile(join(workspace, 'about.md'), 'utf8').catch(() => undefined)
  check('about.md is written: a heading, paragraphs, a list of three', wrote === 'ended' && /^#\s+\S/m.test(about ?? '') && ((about ?? '').match(/^\s*[-*]\s+\S/gm) ?? []).length >= 3, JSON.stringify((about ?? '').slice(0, 160)))

  const built = await send('Now make index.html, a simple one-page site from about.md: warm colours, the heading big, easy to read on a phone. One file, no frameworks.')
  await sleep(2000)
  await drive.capture('index.html, as the thread shows it', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-600) ?? ''`))
  const html = await readFile(join(workspace, 'index.html'), 'utf8').catch(() => undefined)
  check('index.html is written: one page, a big heading, set for phones', built === 'ended' && /<html/i.test(html ?? '') && /<h1/i.test(html ?? '') && /name=["']viewport["']/i.test(html ?? ''), JSON.stringify((html ?? '').slice(0, 120)))

  // 0.425: the card of the turn that made the page shows it RUNNING.
  const card = JSON.parse(String(await drive.capture('index.html on its card, running', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 20 && !document.querySelector('.lc-docpreview__frame'); i += 1) await new Promise((r) => setTimeout(r, 300))
    const frame = [...document.querySelectorAll('.lc-docpreview__frame')].pop()
    frame?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({ frame: !!frame, src: frame?.getAttribute('src') ?? '', height: Math.round(frame?.getBoundingClientRect().height ?? 0) })
  })()`))))
  check('the card of the turn that made index.html shows the page running', card.frame && /^locust-page:\/\/[0-9a-f]{24}\//.test(card.src) && card.height > 200, JSON.stringify(card))

  // 0.422: every long line of a diff scrolled on its own; a line wraps now.
  await drive.evaluate(`[...document.querySelectorAll('.lc-docpreview')].pop()?.querySelector('.lc-docpreview__switch')?.click()`)
  await sleep(600)
  const bars = Number(await drive.evaluate(`[...document.querySelectorAll('.lc-diff__code')].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length`))
  const lines = Number(await drive.evaluate(`document.querySelectorAll('.lc-diff__code').length`))
  check('shown as a change, no line scrolls on its own: long lines wrap', lines > 0 && bars === 0, `${String(bars)} of ${String(lines)} lines scroll sideways`)
  await drive.evaluate(`[...document.querySelectorAll('.lc-docpreview')].pop()?.querySelector('.lc-docpreview__switch')?.click()`)

  // THE PROBE (0.425): the page is swapped for one that reports what it could
  // reach, and the drive reads that report from the app's own window.
  await mkdir(join(workspace, 'css'), { recursive: true })
  await mkdir(join(workspace, 'js'), { recursive: true })
  await writeFile(join(workspace, 'css', 'probe.css'), 'h1 { color: rgb(12, 34, 56); }\n', 'utf8')
  await writeFile(join(workspace, 'data.json'), '{ "ok": true }\n', 'utf8')
  await writeFile(join(workspace, 'js', 'probe.js'), [
    '(async () => {',
    "  const report = { js: true, color: getComputedStyle(document.querySelector('h1')).color }",
    "  try { report.data = (await (await fetch('data.json')).json()).ok } catch (error) { report.data = 'failed: ' + String(error) }",
    "  try { report.parentDocument = typeof parent.document.body } catch { report.parentDocument = 'refused' }",
    '  report.bridge = typeof window.desktop',
    "  try { localStorage.setItem('probe', 'kept'); report.storage = localStorage.getItem('probe') } catch { report.storage = 'refused' }",
    "  try { await fetch('https://example.com/', { mode: 'no-cors' }); report.web = 'reached' } catch { report.web = 'blocked' }",
    "  parent.postMessage({ locustProbe: report }, '*')",
    '})()',
    ''
  ].join('\n'), 'utf8')
  await writeFile(join(workspace, 'index.html'), '<!doctype html>\n<html><head><meta charset="utf-8"><link rel="stylesheet" href="css/probe.css"><script src="js/probe.js" defer></script></head>\n<body><h1>Corner Shop</h1></body></html>\n', 'utf8')
  const probe = JSON.parse(String(await drive.capture('Open index.html: the page, running in the viewer', () => drive.evaluate(`(async () => {
    window.__probes = []
    window.addEventListener('message', (event) => { if (event.data && event.data.locustProbe) window.__probes.push(event.data.locustProbe) })
    const open = [...document.querySelectorAll('button')].filter((b) => /^Open index\\.html/.test(b.innerText.trim())).pop()
    if (!open) return JSON.stringify({ open: false })
    open.click()
    for (let i = 0; i < 40 && window.__probes.length === 0; i += 1) await new Promise((r) => setTimeout(r, 250))
    const frame = document.querySelector('.lc-viewer__page')
    // The app's own window, asked the same: it must still reach nothing.
    let appWeb = 'blocked'
    try { await fetch('https://example.com/', { mode: 'no-cors' }); appWeb = 'reached' } catch { appWeb = 'blocked' }
    return JSON.stringify({ open: true, frame: !!frame, src: frame?.getAttribute('src') ?? '', report: window.__probes[0] ?? null, appWeb, register: document.querySelector('.lc-viewer__register')?.innerText ?? '' })
  })()`))))
  say(`  probe: ${JSON.stringify(probe)}`)
  const report = probe.report ?? {}
  check('Open index.html runs the page in the viewer, at its own address', probe.open && probe.frame && /^locust-page:\/\//.test(probe.src), JSON.stringify({ open: probe.open, frame: probe.frame, src: probe.src }))
  check('its script runs, its own CSS applies, it reads its own data and keeps its own storage', report.js === true && report.color === 'rgb(12, 34, 56)' && report.data === true && report.storage === 'kept', JSON.stringify(report))
  check('it cannot reach Locust: not the window it sits in, not the bridge', report.parentDocument === 'refused' && report.bridge === 'undefined', JSON.stringify({ parentDocument: report.parentDocument, bridge: report.bridge }))
  if (packaged !== undefined) {
    check('on the packaged build it may reach the web, and Locust’s own window still may not', report.web === 'reached' && probe.appWeb === 'blocked', JSON.stringify({ page: report.web, app: probe.appWeb }))
  }
  const source = String(await drive.capture('the Source tab', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-viewer__pagetabs button')].find((b) => b.innerText.trim() === 'Source')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return document.querySelector('.lc-viewer__code')?.innerText ?? ''
  })()`)))
  check('Source shows the page’s own text', /<h1>Corner Shop<\/h1>/.test(source), source.slice(0, 120))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on ${model}, Edit: about.md, then index.html from it.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
