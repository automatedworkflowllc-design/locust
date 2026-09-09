// What the route picker actually offers, in the packaged build.
//
//   node _tools/probe-picker-contents.mjs
//
// A walkthrough of the packaged 0.54.0 build twice failed to select OpenCode's
// free model and went out on Codex instead, spending quota both times. The
// picker said "Nothing matches that." for `free` while the status line read
// "6 runtimes connected" -- so the runtimes were discovered and the question is
// whether their MODEL CATALOGS ever arrive.
//
// This sends nothing to any model. It opens the picker, waits, and prints
// every row it can see, twice: once immediately and once after twenty seconds.
// If the second reading is longer than the first, the catalog is simply slow
// and the walkthrough was racing it. If both are short, the packaged build
// cannot read the catalog at all and that is a real defect a person would hit
// on the day they installed it.
//
// Costs nothing: no mission is started.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

/*
 * `--dev` runs the SAME probe against the development build.
 *
 * The question this answers is how much is in doubt: if the shared helper
 * fails only against the packaged binary, the drives that verified routes on
 * dev are still evidence. If it fails on both, roughly sixty drives have been
 * asserting things about a route they may never have switched.
 */
const DEV = process.argv.includes('--dev')
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!DEV && !existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}
say(DEV ? 'probing the DEV build' : 'probing the PACKAGED build')

const workspace = await scratchRepository('locust-probe-picker-ws-')
const drive = await startDrive({
  name: DEV ? 'picker-contents-dev' : 'picker-contents',
  port: DEV ? 9424 : 9423,
  ...(DEV ? {} : { packaged: EXE }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Every row the picker is showing, by group, plus what it says when empty. */
const READ_PICKER = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return JSON.stringify({ error: 'no route control' })
  if (document.querySelector('.lc-picker') === null) {
    control.click()
    await new Promise((r) => setTimeout(r, 900))
  }
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return JSON.stringify({ error: 'picker would not open' })
  const groups = [...picker.querySelectorAll('.lc-picker__group')].map((el) => (el.textContent ?? '').trim())
  const rows = [...picker.querySelectorAll('.lc-picker__row')].map((el) => (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
  const empty = picker.querySelector('.lc-inspector__empty')
  return JSON.stringify({
    groups,
    rowCount: rows.length,
    rows: rows.slice(0, 30),
    emptyMessage: empty === null ? null : (empty.textContent ?? '').trim(),
    statusLine: (document.querySelector('.lc-sidebar__foot')?.textContent ?? '').trim()
  })
})()`

/**
 * Search the picker, then click a matching row, and watch the route chip.
 *
 * Written here rather than assembled by a script, because every scripted
 * version of this file so far has eaten a backslash: one `replace(/\s+/g)`
 * arrived as `/s+/g` and silently deleted the letter s from every word it
 * printed, which read exactly like the app rendering corrupt text.
 */
const SEARCH_THEN_CLICK = `(async () => {
  const chipText = () => {
    const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
    return (c?.textContent ?? '').trim()
  }
  if (document.querySelector('.lc-picker') === null) {
    const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    control?.click()
    await new Promise((r) => setTimeout(r, 900))
  }
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return JSON.stringify({ error: 'picker would not open' })
  const before = chipText()
  const box = picker.querySelector('.lc-picker__input')
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setInput.call(box, 'free')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 800))
  const rows = [...picker.querySelectorAll('.lc-picker__row')]
  const target = rows.find((el) => /free/i.test(el.querySelector('.lc-picker__label')?.textContent ?? ''))
  if (target === undefined) {
    return JSON.stringify({ before, filteredRows: rows.length, picked: null })
  }
  const label = (target.querySelector('.lc-picker__label')?.textContent ?? '').trim()
  target.click()
  await new Promise((r) => setTimeout(r, 1200))
  return JSON.stringify({
    before,
    filteredRows: rows.length,
    picked: label,
    pickerStillOpen: document.querySelector('.lc-picker') !== null,
    after: chipText()
  })
})()`

try {
  await drive.capture('the picker, as soon as the window is up', async () => {
    await drive.ready()
    return drive.evaluate(READ_PICKER)
  })

  await drive.capture('the same picker, twenty seconds later', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    return drive.evaluate(READ_PICKER)
  })

  await drive.capture('and what searching for free finds now', async () => {
    return drive.evaluate(`(async () => {
      const picker = document.querySelector('.lc-picker')
      if (picker === null) return JSON.stringify({ error: 'picker closed' })
      const box = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'free')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 800))
      const rows = [...picker.querySelectorAll('.lc-picker__row')].map((el) => (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
      const empty = picker.querySelector('.lc-inspector__empty')
      return JSON.stringify({
        matched: rows.length,
        rows: rows.slice(0, 10),
        emptyMessage: empty === null ? null : (empty.textContent ?? '').trim()
      })
    })()`)
  })
  await drive.capture('what pickRouteScript itself reports', async () => {
    // The helper returns a diagnostic string -- 'no route control', 'row not
    // found', or the row it chose. Every drive discards it, which is why two
    // walkthroughs failed to switch runtime without anyone learning why.
    // CLOSE the picker first. Every drive that uses this helper successfully
    // calls it from a closed state; this probe (and the walkthrough) left it
    // open, and the helper opens with `control.click()` -- which on an open
    // picker CLOSES it. That is the difference worth testing.
    await drive.evaluate(`(async () => {
      if (document.querySelector('.lc-picker') !== null) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((r) => setTimeout(r, 600))
      }
      return document.querySelector('.lc-picker') === null ? 'closed' : 'still open'
    })()`)
    const said = await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
    const chip = await drive.evaluate(`(() => {
      const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
      return (c?.textContent ?? '').replace(/\s+/g, ' ').trim()
    })()`)
    return `pickRouteScript said ${JSON.stringify(String(said))}; the chip now reads ${JSON.stringify(String(chip))}`
  })
  await drive.capture('click an OpenCode free row by hand and watch the chip', async () => {
    return drive.evaluate(`(async () => {
      const chipText = () => {
        const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
        return (c?.textContent ?? '').replace(/\s+/g, ' ').trim()
      }
      const before = chipText()
      if (document.querySelector('.lc-picker') === null) {
        const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
        control?.click()
        await new Promise((r) => setTimeout(r, 900))
      }
      const picker = document.querySelector('.lc-picker')
      if (picker === null) return JSON.stringify({ error: 'picker would not open' })
      const list = picker.querySelector('.lc-picker__list')
      let group = ''
      const seen = []
      let target = null
      for (const node of list.children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = (header.textContent ?? '').trim()
        const rowEl = node.querySelector('.lc-picker__row')
        if (rowEl === null) continue
        const label = (rowEl.querySelector('.lc-picker__label')?.textContent ?? '').trim()
        seen.push({ group, label, disabled: rowEl.disabled === true, tag: (rowEl.querySelector('.lc-picker__tag')?.textContent ?? '').trim() })
        if (target === null && /opencode/i.test(group) && /free/i.test(label)) target = rowEl
      }
      if (target === null) return JSON.stringify({ before, seen: seen.slice(0, 12), picked: null })
      const pickedLabel = (target.querySelector('.lc-picker__label')?.textContent ?? '').trim()
      const wasDisabled = target.disabled === true
      target.click()
      await new Promise((r) => setTimeout(r, 1200))
      return JSON.stringify({
        before,
        picked: pickedLabel,
        wasDisabled,
        pickerStillOpen: document.querySelector('.lc-picker') !== null,
        after: chipText()
      })
    })()`)
  })
  await drive.capture('what pickRouteScript-s own predicate sees', async () => {
    return drive.evaluate(`(async () => {
      if (document.querySelector('.lc-picker') === null) {
        const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
        control?.click()
        await new Promise((r) => setTimeout(r, 900))
      }
      const picker = document.querySelector('.lc-picker')
      const box = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'free')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      let current = ''
      const rows = []
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) current = header.innerText
        const candidate = node.querySelector('.lc-picker__row')
        if (!candidate) continue
        rows.push({
          groupInnerText: current,
          rowInnerText: (candidate.innerText ?? '').replace(/\s+/g, ' ').slice(0, 60),
          rowTextContent: (candidate.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60),
          groupMatches: /opencode/i.test(current),
          rowMatches: /free/i.test(candidate.innerText ?? '')
        })
      }
      return JSON.stringify({ rows: rows.slice(0, 8) })
    })()`)
  })
  await drive.capture('does clicking a row work AFTER a search', async () => {
    /*
     * The one difference left between the helper (fails) and a hand click
     * (works): the helper types a search first. If selection stops applying
     * once the list is filtered, that is a real defect -- searching then
     * choosing is the ordinary way to use this control.
     */
    return drive.evaluate(SEARCH_THEN_CLICK)
  })
} finally {
  await drive.finish({
    intro: 'Reading the packaged build’s route picker. Nothing is sent to any model.'
  })
}

say('done')
