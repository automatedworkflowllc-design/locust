// Fresh-eyes area 25: someone writing or designing drafts a page and a simple design.
//
//   node _tools/drive-a-page-and-a-design.mjs [--packaged <exe>] [--tag <name>]
//
// Ada (a free model, Edit) writes about.md -- a short About page for a bakery
// -- and then index.html, a one-page site made from it. The drive checks both
// files on disk and photographs how each reads in the thread, then opens the
// page from the thread to see what Locust shows a person for a design.

import { mkdir, readFile } from 'node:fs/promises'
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

  // 0.422: every long line of a diff scrolled on its own; a line wraps now.
  const bars = Number(await drive.evaluate(`[...document.querySelectorAll('.lc-diff__code')].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length`))
  check('no diff line scrolls on its own: long lines wrap', bars === 0, `${String(bars)} lines scroll sideways`)
  const opened = String(await drive.capture('Open index.html from the thread', () => drive.evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].filter((b) => /^Open index\\.html/.test(b.innerText.trim())).pop()
    if (!open) return JSON.stringify({ open: false, buttons: [...document.querySelectorAll('.lc-thread button')].map((b) => b.innerText.trim()).filter(Boolean).slice(-8) })
    open.click()
    await new Promise((r) => setTimeout(r, 1500))
    const viewer = document.querySelector('.lc-viewer, .has-viewer [class*="viewer"]')
    return JSON.stringify({ open: true, viewer: !!viewer, frame: !!document.querySelector('iframe, webview'), text: (viewer?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300) })
  })()`)))
  say(`  opened: ${opened}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on ${model}, Edit: about.md, then index.html from it.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
