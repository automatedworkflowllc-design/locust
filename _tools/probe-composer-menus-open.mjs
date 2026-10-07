// The chat box's menus can be seen when they open (0.687).
//
//   node _tools/probe-composer-menus-open.mjs [--packaged <exe>] [--tag <name>]
//
// 0.686 wrapped the chat area in voice-glow's VoiceBeam, whose wrapper is `overflow: hidden` -- and every menu in the
// chat box (chat type, mode, model) opens upward from inside it, so each was clipped to a sliver. Opens each menu,
// finds the one that appeared, and asks the page what is at the middle of its first item: the item itself, or
// whatever is under a clipped menu. Closes it with Esc before the next. Free: no run. 0.681 passes, 0.686 fails.

import { join } from 'node:path'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const workspace = await scratchRepository('locust-probe-menus-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `probe-composer-menus-open-${tag}`, port: 9871, workspace, sendsNothing: true,
  outPath: join(recordRoot('probe-composer-menus-open-2026-10-07'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-07T00:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const MENUS = `.lc-menu, [role=menu], [role=listbox], .lc-picker`
const open = (label, opener) => `(async () => {
  const before = new Set(document.querySelectorAll(${JSON.stringify(MENUS)}))
  const button = ${opener}
  if (!button) return JSON.stringify({ label: ${JSON.stringify(label)}, found: false })
  button.click()
  await new Promise((r) => setTimeout(r, 700))
  const menu = [...document.querySelectorAll(${JSON.stringify(MENUS)})].find((el) => !before.has(el) && el.getBoundingClientRect().height > 0)
  if (!menu) return JSON.stringify({ label: ${JSON.stringify(label)}, found: true, menu: false })
  // Just inside the menu's top edge: the part a clip hides first. (Its first row can be scrolled away on purpose --
  // the model list scrolls to the model in use -- so a row is not the test.)
  const box = menu.getBoundingClientRect()
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12)
  return JSON.stringify({ label: ${JSON.stringify(label)}, found: true, menu: true, visible: hit !== null && (menu === hit || menu.contains(hit)), top: Math.round(box.top) })
})()`
const close = `(async () => {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  document.querySelector('.lc-composer__box textarea')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
})()`
try {
  await drive.ready()
  await drive.resize(1200, 800)
  const menus = [
    ['chat type', `document.querySelector('button[aria-label^="Chat mode"]')`],
    ['permission mode', `document.querySelector('button[aria-label="Permission mode"]')`],
    ['model', `[...document.querySelectorAll('.lc-composer button')].find((b) => /Claude|Codex|OpenCode|Cursor|Copilot|Muse|Antigravity/.test(b.innerText) && b.getAttribute('aria-haspopup') !== null)`]
  ]
  for (const [label, opener] of menus) {
    const seen = JSON.parse(String(await drive.capture(`${label} menu open`, () => drive.evaluate(open(label, opener)))))
    const ok = seen.found === false || (seen.menu === true && seen.visible === true)
    if (!ok) failures += 1
    say(`  [${ok ? 'PASS' : 'FAIL'}] the ${label} menu can be seen -- ${JSON.stringify(seen)}`)
    await drive.evaluate(close)
    await sleep(300)
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Each chat-box menu opened; is its first item on top?`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
