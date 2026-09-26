// The conversation's right-click menu, driven the way a mouse and keyboard
// drive it, and measured against the window.
//
//   node _tools/drive-context-menu.mjs --reuse <profile> [--packaged <exe>] [--label name]
//
// Colin, 2026-09-22: "right click folding under window, also can we clean it
// up a little bit like the one you use?" So: a right-click where the row is,
// a right-click at the very bottom of the window (a row low in a long list),
// the Assign to list opened by hovering, arrow keys, and one letter key --
// each checked for whether all of the menu is inside the window. Sends
// nothing.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const reuse = arg('--reuse')
const packaged = arg('--packaged')
const label = arg('--label') ?? (packaged === undefined ? 'after' : 'before')
if (reuse === undefined) throw new Error('--reuse <profile> [--packaged <exe>] [--label name]')

const OUT = join(recordRoot('context-menu-2026-09-22'), label)
await mkdir(OUT, { recursive: true })
await writeFile(join(reuse, 'window.json'), JSON.stringify({ x: 0, y: 0, width: 1477, height: 920, maximized: false }), 'utf8')

// The sidebar lists the conversations of the folder the app opens in, so it
// opens in the folder the profile's conversation was held in.
const workspace = await readFile(join(reuse, 'font-frames.json'), 'utf8')
  .then((text) => JSON.parse(text).workspace)
  .catch(() => process.cwd())

const drive = await startDrive({
  name: `context-menu-${label}`,
  port: 9371,
  workspace,
  profilePath: reuse,
  keep: true,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged })
})

const shoot = async (file) => {
  await sleep(500)
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
  say(`   frame ${file}`)
}
const mouse = async (type, x, y, button = 'none', clickCount = 0) =>
  drive.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount })
const key = async (keyName, code, text) => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, ...(text === undefined ? {} : { text }) })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code })
  await sleep(250)
}
/** Where the menu and any open submenu sit, against the window. */
const measure = () => drive.evaluate(`(() => {
  const menu = document.querySelector('.lc-context')
  if (!menu) return JSON.stringify({ open: false })
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } }
  const sub = menu.querySelector('.lc-context__sub')
  const inside = (b) => b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight
  const rows = [...menu.querySelectorAll(':scope > .lc-context__item, :scope > .lc-context__row > .lc-context__item')]
    .map((b) => (b.querySelector('.lc-context__label')?.textContent ?? b.innerText).trim() + (b.querySelector('.lc-context__key') ? ' [' + b.querySelector('.lc-context__key').textContent + ']' : ''))
  return JSON.stringify({
    open: true,
    window: window.innerWidth + 'x' + window.innerHeight,
    menu: box(menu), menuInside: inside(box(menu)),
    sub: sub ? box(sub) : null, subInside: sub ? inside(box(sub)) : null,
    subItems: sub ? [...sub.querySelectorAll('.lc-context__item')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()) : [],
    focused: document.activeElement?.closest('.lc-context') ? (document.activeElement.querySelector?.('.lc-context__label')?.textContent ?? document.activeElement.className) : 'outside the menu',
    rows,
    title: menu.querySelector('.lc-context__title') ? 'TITLE BAR' : 'no title bar'
  })
})()`)
const row = () => drive.evaluate(`(() => {
  const el = [...document.querySelectorAll('.lc-conv')].find((r) => /Read README/.test(r.innerText))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) })
})()`)

try {
  await drive.ready()
  const at = JSON.parse((await row()) ?? 'null')
  if (at === null) throw new Error('no conversation row to right-click')

  say('1. right-click the conversation where it is')
  await mouse('mouseMoved', at.x, at.y)
  await mouse('mousePressed', at.x, at.y, 'right', 1)
  await mouse('mouseReleased', at.x, at.y, 'right', 1)
  await sleep(400)
  say(`   ${await measure()}`)
  await shoot('01-where-the-row-is.png')
  await key('Escape', 'Escape')

  say('2. right-click at the very bottom of the window (a row low in a long list)')
  const bottom = await drive.evaluate(`(async () => {
    const el = [...document.querySelectorAll('.lc-conv')].find((r) => /Read README/.test(r.innerText))
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: window.innerHeight - 24 }))
    await new Promise((r) => setTimeout(r, 400))
    return 'opened at y=' + (window.innerHeight - 24)
  })()`)
  say(`   ${bottom}`)
  say(`   ${await measure()}`)
  await shoot('02-at-the-bottom.png')

  say('3. hover Assign to')
  const assign = await drive.evaluate(`(() => {
    const b = [...document.querySelectorAll('.lc-context .lc-context__item')].find((x) => /^Assign to/.test(x.innerText.trim()))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) })
  })()`)
  if (assign !== null && assign !== undefined) {
    const point = JSON.parse(assign)
    await mouse('mouseMoved', point.x, point.y)
    await sleep(400)
    say(`   ${await measure()}`)
    await shoot('03-assign-to.png')
  } else {
    say('   no Assign to row (the old menu lists one row per teammate)')
  }
  await key('Escape', 'Escape')
  await key('Escape', 'Escape')

  say('4. keys: open, ArrowDown twice, then R')
  await mouse('mousePressed', at.x, at.y, 'right', 1)
  await mouse('mouseReleased', at.x, at.y, 'right', 1)
  await sleep(400)
  await key('ArrowDown', 'ArrowDown')
  await key('ArrowDown', 'ArrowDown')
  say(`   after two ArrowDowns: ${JSON.parse(await measure()).focused}`)
  await key('r', 'KeyR', 'r')
  const renaming = await drive.evaluate(`(() => ({ menuOpen: document.querySelector('.lc-context') !== null, renameField: document.activeElement?.tagName === 'INPUT' && document.activeElement.closest('.lc-sidebar') !== null }))()`)
  say(`   after R: ${JSON.stringify(renaming)}`)
  await shoot('04-after-r.png')
  await key('Escape', 'Escape')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Context menu, ${label}.` })
}
