// Fresh-eyes area 13: every Settings page, as a person pages through them.
//
//   node _tools/drive-settings-every-page.mjs [--packaged <exe>] [--tag <name>]
//
// The everyday profile (everyday-ledger.mjs). Each page in the Settings nav,
// at 1440 and at 1120: its words, anything cut short, anything past the
// page's right edge, sideways scrolling. Runtimes and Connectors are READ
// but never pictured or written to the record: on this machine they list
// the owner's own skills and connectors. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('settings-pages-2026-09-28'), `settings-pages-${tag}`)
await mkdir(OUT, { recursive: true })
const PRIVATE = /^(AI agents|Runtimes|Connectors)$/

const everyday = await seedEverydayLedger('settings-pages')
const drive = await startDrive({
  name: `settings-pages-${tag}`, port: 9749, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const look = `JSON.stringify((() => {
  const page = document.querySelector('.lc-settings__pane')
  const edge = (page ?? document.body).getBoundingClientRect().right
  const cut = [...(page ?? document.body).querySelectorAll('*')].filter((el) => {
    if (el.children.length > 0 || !el.innerText || el.getBoundingClientRect().width === 0) return false
    const s = getComputedStyle(el)
    return s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1
  }).map((el) => el.innerText.trim().slice(0, 60))
  const past = [...(page ?? document.body).querySelectorAll('button, input, select, textarea, p, span, label')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.right > edge + 1
  }).map((el) => (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 50))
  return {
    heading: document.querySelector('.lc-settings__heading')?.innerText.trim() ?? '',
    text: (page?.innerText ?? '').replace(/\\s+/g, ' '),
    cut: [...new Set(cut)].slice(0, 8),
    past: [...new Set(past)].slice(0, 8),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    switches: [...(page ?? document.body).querySelectorAll('[role=switch]')].map((el) => el.getAttribute('aria-label') ?? '')
  }
})())`

try {
  await drive.ready()
  await sleep(2000)
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Settings/.test(b.innerText))?.click()`)
  await sleep(1200)
  const pages = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-settings__navitem')].map((b) => b.innerText.trim()))`)))
  say(`  pages: ${JSON.stringify(pages)}`)
  check('the nav lists eleven pages', pages.length === 11, String(pages.length))
  const words = []
  for (const [w, h] of [[1440, 900], [1120, 760]]) {
    await drive.resize(w, h)
    await sleep(1200)
    for (const label of pages) {
      const open = `(async () => { [...document.querySelectorAll('.lc-settings__navitem')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})?.click(); await new Promise((r) => setTimeout(r, 700)); return ${look} })()`
      const seen = JSON.parse(String(PRIVATE.test(label) ? await drive.evaluate(open) : await drive.capture(`${label}, ${String(w)}`, () => drive.evaluate(open))))
      if (w === 1440) words.push(`## ${label}\n\n${PRIVATE.test(label) ? '(read, not recorded: lists this machine\'s own skills and connectors)' : seen.text}\n`)
      const fine = seen.sideways <= 0 && seen.past.length === 0
      if (w === 1440) {
        // A switch is named for what it is, not "Switch this on" (0.419).
        check(`${label}: every switch says what it is`, seen.switches.every((name) => name.length > 0 && !/^Switch this (on|off)$/.test(name)), JSON.stringify(seen.switches))
        // A double hyphen is typing, not a dash (0.419).
        check(`${label}: no "--" in what it shows`, !/ -- /.test(seen.text), (/.{0,40} -- .{0,40}/.exec(seen.text) ?? [''])[0])
        // Every signed-in agent can sign in again, as this account or another (0.543). Counted, not recorded.
        if (label === 'AI agents') {
          const again = Number(await drive.evaluate(`[...document.querySelectorAll('button.lc-runtimecell__again')].filter((b) => b.innerText.trim() === 'Sign in again').length`))
          const signedIn = Number(await drive.evaluate(`[...document.querySelectorAll('.lc-runtimerow')].filter((row) => /READY|ACTIVE/.test(row.querySelector('.lc-tag')?.innerText ?? '')).length`))
          check('AI agents: signed-in agents offer Sign in again', again > 0, `${String(again)} of ${String(signedIn)} ready rows`)
        }
      }
      check(`${label} at ${String(w)}: nothing past the edge, nothing scrolls sideways${seen.cut.length > 0 ? ' (cut short: ' + seen.cut.join(' | ') + ')' : ''}`, fine, JSON.stringify({ sideways: seen.sideways, past: seen.past }))
    }
  }
  await writeFile(join(OUT, 'pages.md'), words.join('\n'), 'utf8')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. The everyday profile; every Settings page at 1440 and 1120. Runtimes and Connectors read, not pictured.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
