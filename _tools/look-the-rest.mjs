// The screens and menus look-every-screen.mjs does not open, to be looked at
// (design pass, 0.715): the model picker, the chat box's menus, the New
// teammate dialog, the Board, the command palette -- on the everyday profile
// at Colin's window size. Nothing is sent; the pictures are read.
//
//   node _tools/look-the-rest.mjs [--packaged <exe>] [--size WxH] [--tag <name>]

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const [width, height] = (arg('--size') ?? '1209x770').split('x').map(Number)
const everyday = await seedEverydayLedger('look-the-rest')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `look-the-rest-${tag}`,
  port: 9877,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: join(recordRoot('look-the-rest-2026-10-09'), `${tag}-${String(width)}x${String(height)}`),
  seed: everyday.seed
})
const escape = `(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 500)); return 1 })()`
const press = (find) => `(async () => {
  const target = (${find})()
  if (!target) return 'not found'
  target.click()
  await new Promise((r) => setTimeout(r, 900))
  return 'opened'
})()`

try {
  await drive.ready()
  await drive.resize(width, height)
  await sleep(2000)
  await drive.capture('the model picker', () => drive.evaluate(press(`() => [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')`)))
  await drive.evaluate(escape)
  await drive.capture('the mode menu', () => drive.evaluate(press(`() => [...document.querySelectorAll('.lc-composer button')].find((b) => /^(Edit|Ask|Plan|Auto|Approve)/.test(b.innerText.trim()))`)))
  await drive.evaluate(escape)
  await drive.capture('the chat mode menu', () => drive.evaluate(press(`() => document.querySelector('.lc-composer button[aria-haspopup]:not(.lc-control)')`)))
  await drive.evaluate(escape)
  await drive.capture('New teammate', () => drive.evaluate(press(`() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'New teammate')`)))
  await drive.evaluate(escape)
  await sleep(500)
  await drive.capture('the command palette', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    return document.querySelector('.lc-palette') ? 'opened' : 'no palette'
  })()`))
  await drive.evaluate(escape)
  await drive.capture('the Board', () => drive.evaluate(press(`() => [...document.querySelectorAll('.lc-sidebar button')].find((b) => b.innerText.trim() === 'Board')`)))
  say('captured')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The everyday profile at ${String(width)}x${String(height)}: the menus, dialogs and screens look-every-screen does not open.`, extra: '' })
}
