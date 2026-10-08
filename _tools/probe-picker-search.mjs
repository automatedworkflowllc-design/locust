// How soon the route picker lists OpenCode's free models, and whether the drives' pick finds one (2026-10-08).
//
//   node _tools/probe-picker-search.mjs [--packaged <exe>]
//
// Sends nothing. Opens the picker with "free" typed and prints its row count second by second after
// "ready", then runs drive-lib's own free-route pick and prints what it said, then the catalog's usage
// readings. On 0.708 the rows came 14 s after ready: every list waited for Antigravity's usage (0.709).

import { FREE_ROW, FREE_SEARCH, pickRouteScript, scratchRepository, startDrive, say } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const drive = await startDrive({
  name: 'probe-picker-search',
  port: 9871,
  workspace: await scratchRepository('locust-probe-picker-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged })
})
try {
  await drive.ready()
  const t0 = Date.now()
  // The picker open with "free" typed: how many OpenCode rows it lists, second by second after "ready".
  const timeline = await drive.evaluate(`(async () => {
    const t = Date.now()
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!document.querySelector('.lc-picker')) control.click()
    await new Promise(r => setTimeout(r, 300))
    const box = document.querySelector('.lc-picker__input')
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(box, 'free')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    const seen = []
    let last = -1
    for (let i = 0; i < 120; i += 1) {
      const rows = [...document.querySelectorAll('.lc-picker__row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())
      if (rows.length !== last) { seen.push({ s: Math.round((Date.now() - t) / 100) / 10, n: rows.length, first: rows.slice(0, 3) }); last = rows.length }
      await new Promise((r) => setTimeout(r, 500))
    }
    return JSON.stringify(seen)
  })()`)
  say(`free rows over 60 s: ${timeline}`)
  for (const search of [FREE_SEARCH, 'free']) {
    const said = await drive.evaluate(pickRouteScript({ group: '/opencode/i', search, row: FREE_ROW }))
    const chip = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim()`)
    say(`pick ${FREE_ROW} by "${search}": ${String(said).slice(0, 1200)} || chip: ${String(chip)}`)
  }
  const usage = await drive.evaluate(`(async () => { const r = await window.desktop.listModels(); return JSON.stringify(r.ok ? Object.keys(r.data.usageWindows ?? {}).map((k) => k + ': ' + String(r.data.usageWindows[k]).slice(0, 60)) : r) })()`)
  say(`usage windows in the catalog: ${String(usage)}`)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Picker searches on the packaged build.' })
}
