// What routes this machine actually offers, read off the picker. Sends nothing.
//
//   node _tools/list-routes.mjs [search]
//
// Written because choosing a "cheap model" from memory is choosing from a
// guess: the picker reads as NAMES since 0.196.0, and the ids behind them are
// whatever each CLI reports today.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const search = process.argv[2] ?? ''
const workspace = await scratchRepository('locust-routes-ws-')
const drive = await startDrive({ name: 'routes', port: 9523, workspace, spends: false })

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('every route the picker offers', () => drive.evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    if (!document.querySelector('.lc-picker')) control.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-picker__list'); i += 1) await new Promise(r => setTimeout(r, 200))
    const box = document.querySelector('.lc-picker__input')
    if (box && ${JSON.stringify(search)}) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(box, ${JSON.stringify(search)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
    }
    const out = []
    let group = ''
    for (const node of document.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) group = header.innerText.replace(/\\s+/g, ' ').trim()
      const row = node.querySelector('.lc-picker__row')
      if (row) out.push((row.disabled ? '[off] ' : '      ') + group + '  ::  ' + row.innerText.replace(/\\s+/g, ' ').trim())
    }
    return out.join('\\n')
  })()`))
} catch (error) {
  say(`failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Reading the route picker. Nothing sent.' })
}
