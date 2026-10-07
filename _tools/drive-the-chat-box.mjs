// The chat box's own menus, as a person opens them (fresh-eyes check, area
// "The chat box").
//
//   node _tools/drive-the-chat-box.mjs [--packaged <exe>] [--tag <name>]
//
// Sends nothing. With a teammate picked, at 1440x900 and 1120x720, each of
// the chat box's menus is opened, captured, measured and closed with Escape:
// the mode menu, the model picker, effort, the + menu, and the slash commands.
// Each must open whole inside the window, show its choices, and close.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('the-chat-box-2026-09-27'), `the-chat-box-${tag}`)
await mkdir(OUT, { recursive: true })
const drive = await startDrive({
  name: `chat-box-${tag}`, port: 9731, workspace: await scratchRepository('locust-chat-box-ws-'), outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
// What opened, where it sits, and what it offers. `panel` is a selector for
// the thing that opened; it must lie inside the window.
const measure = (panel) => `JSON.stringify((() => {
  const el = document.querySelector(${JSON.stringify(panel)})
  if (!el) return { open: false }
  const r = el.getBoundingClientRect()
  const items = [...el.querySelectorAll('[role=menuitem], [role=menuitemradio], [role=option], .lc-slash__item, .lc-picker__row, .lc-plusmenu__satellite, button')].filter((i) => i.offsetParent !== null)
  const chosen = el.querySelector('.lc-picker__row.is-active')
  const list = el.querySelector('.lc-picker__list')
  const chosenInView = chosen && list ? (() => { const c = chosen.getBoundingClientRect(); const l = list.getBoundingClientRect(); return c.top >= l.top - 1 && c.bottom <= l.bottom + 1 })() : null
  return {
    open: true,
    text: el.innerText.replace(/\\s+/g, ' ').slice(0, 80),
    chosenInView,
    inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
    items: items.length,
    first: items.slice(0, 6).map((i) => (i.innerText || i.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40))
  }
})())`
const escape = () => drive.evaluate(`(async () => {
  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
})()`)
const MENUS = [
  { name: 'the mode menu', open: `document.querySelector('button[aria-label="Permission mode"]')?.click()`, panel: '.lc-menu[aria-label="Permission mode"]', min: 3 },
  { name: 'the model picker', open: `[...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.click()`, panel: '.lc-picker', min: 3 },
  // Effort is a slider, not a list: it counts as open with its name on it.
  { name: 'effort', open: `document.querySelector('button[aria-label="Reasoning effort"]')?.click()`, panel: '.lc-menu[aria-label="Reasoning effort"], [role=menu][aria-label*="ffort"]', min: 0, says: /Effort/ },
  { name: 'the + menu', open: `document.querySelector('.lc-plusmenu__main')?.click()`, panel: '.lc-plusmenu.is-open', min: 2 },
  {
    name: 'the slash commands',
    open: `(() => {
      const field = document.querySelector('form.command-dock textarea')
      field.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, '/')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
    panel: '.lc-slash',
    min: 3,
    after: `(() => { const field = document.querySelector('form.command-dock textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(field, ''); field.dispatchEvent(new Event('input', { bubbles: true })) })()`
  }
]

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(800)
  /*
   * The window reads the model list at launch, before OpenCode is ready, and again
   * moments later. Opened in between, the picker had no row for Wren's free model to
   * open on, and the chat box no effort for it; both read right a few seconds later
   * (0.698 and 0.699: 24 rows at the first size, 34 at the second). The effort control
   * appears once the window knows Wren's model: wait for it, so the sizes compare the
   * layout, not the clock.
   */
  await drive.waitFor(`document.querySelector('button[aria-label="Reasoning effort"]') !== null`, { timeoutMs: 60_000, what: "the window knowing Wren's model (its effort control)" })
  for (const [width, height] of [[1440, 900], [1120, 720]]) {
    await drive.resize(width, height)
    await sleep(900)
    for (const menu of MENUS) {
      await drive.evaluate(menu.open)
      await sleep(700)
      const label = `${String(width)}x${String(height)}: ${menu.name}`
      const seen = JSON.parse(String(await drive.capture(label, () => drive.evaluate(measure(menu.panel)))))
      check(`${label} opens whole inside the window, with its choices`, seen.open && seen.inside && seen.items >= menu.min && (menu.says === undefined || menu.says.test(seen.text)), JSON.stringify(seen).slice(0, 200))
      // 0.411: the picker opens on what the teammate is on (a free OpenCode model, far down its list).
      if (menu.name === 'the model picker') check(`${label}: it opens on the chosen model, in view`, seen.chosenInView === true, String(seen.chosenInView))
      await escape()
      if (menu.after !== undefined) await drive.evaluate(menu.after)
      const still = JSON.parse(String(await drive.evaluate(measure(menu.panel))))
      check(`${label} closes on Escape`, !still.open, JSON.stringify(still).slice(0, 80))
      if (still.open) { await drive.evaluate(`document.body.click()`); await sleep(300) }
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren picked; every chat box menu opened, measured and closed, at two sizes.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
