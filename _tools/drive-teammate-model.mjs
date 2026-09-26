// A teammate's own model, set from their dialog; the + as the right-click menu; the updates switch in two words.
//
//   node _tools/drive-teammate-model.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-24, three asks in one sitting:
//  1. "do we have the ability to switch a teammates model? like not when youre
//     in the chat but the actual designated teammate" -- it changed only by
//     sending them a message on another model; the Edit dialog said "Whichever
//     route is active when a mission starts".
//  2. "make the + button for new teammate and group the same style as our
//     right click dropdowns, those are way cleaner".
//  3. Settings > Updates: "maybe switch this button to test build or beta
//     build, this is wayyy too wordy".
// Sends nothing: the model is picked and saved, never run. Read back after
// the app is opened again on the same profile.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `teammate-model-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-teammate-model-ws-')
const launch = (more) => startDrive({
  name: `teammate-model-${tag}`,
  port: 9521,
  workspace,
  outPath: OUT,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...more
})
let drive = await launch({
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'low' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const json = async (script) => JSON.parse(String(await drive.evaluate(script)))

// The Edit dialog, opened the way a person does: right-click the face, Edit.
const openEdit = `(async () => {
  const face = ${teammateFace('Wren')}
  if (!face) return 'no face'
  const box = face.getBoundingClientRect()
  face.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 }))
  await new Promise((r) => setTimeout(r, 400))
  const edit = [...document.querySelectorAll('.lc-context__item')].find((b) => /^Edit/.test(b.textContent.trim()))
  if (!edit) return 'no Edit item'
  edit.click()
  await new Promise((r) => setTimeout(r, 600))
  return document.querySelector('.lc-dialog[aria-label="Edit teammate"]') ? 'open' : 'no dialog'
})()`
const MODEL_ROW = `(() => JSON.stringify({
  name: document.querySelector('.lc-teammatemodel__name')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
  picker: document.querySelector('.lc-teammatemodel__picker .lc-picker') !== null,
  dialog: document.querySelector('.lc-dialog') !== null
}))()`

let handover
try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(2500)

  // --- The +, as the right-click menu.
  const menu = await json(`(async () => {
    const plus = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Add')
    plus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    plus.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    plus.click()
    await new Promise((r) => setTimeout(r, 400))
    const open = document.querySelector('.lc-context[aria-label="Add"]')
    const rows = open === null ? [] : [...open.querySelectorAll('.lc-context__item')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())
    const expanded = plus.getAttribute('aria-expanded')
    // A second press, with the events a mouse sends: it closes rather than reopening.
    plus.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    plus.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    plus.click()
    await new Promise((r) => setTimeout(r, 400))
    const after = document.querySelector('.lc-context[aria-label="Add"]') !== null
    return JSON.stringify({ rows, expanded, closedByPlus: !after, oldMenu: document.querySelector('.lc-sidebar__addmenu') !== null })
  })()`)
  await drive.capture('the + menu, drawn as the right-click menus are', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Add').click()
    await new Promise((r) => setTimeout(r, 400))
    return document.querySelector('.lc-context[aria-label="Add"]')?.innerText.replace(/\\s+/g, ' ') ?? 'no menu'
  })()`))
  check('the + opens the right-click menu with its three rows and their keys', JSON.stringify(menu.rows) === JSON.stringify(['New teammateT', 'New roomR', 'New groupG']) && menu.expanded === 'true' && menu.oldMenu === false, JSON.stringify(menu))
  check('a second press on the + closes it', menu.closedByPlus === true, JSON.stringify(menu))
  const keyed = String(await drive.evaluate(`(async () => {
    document.querySelector('.lc-context[aria-label="Add"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))
    await new Promise((r) => setTimeout(r, 600))
    return document.querySelector('.lc-dialog[aria-label="New teammate"]') ? 'New teammate open' : 'not open'
  })()`))
  check('T opens New teammate from the menu', keyed === 'New teammate open', keyed)
  const fresh = await json(MODEL_ROW)
  check('a new teammate’s Model row says it takes the chat box’s model until one is picked', /the chat box's, until you pick one/.test(fresh.name ?? ''), JSON.stringify(fresh))
  await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-dialog button')].find((b) => b.textContent.trim() === 'Cancel')?.click() })()`)
  await sleep(500)

  // --- The teammate's own model, from their dialog.
  check('Edit opens from the right-click menu', String(await drive.evaluate(openEdit)) === 'open')
  const before = await json(MODEL_ROW)
  check('the Model row names their model', /^Codex \/ GPT-6[- ]Luna/.test(before.name ?? ''), JSON.stringify(before))
  const escaped = await json(`(async () => {
    ;[...document.querySelectorAll('.lc-teammatemodel button')].find((b) => b.textContent.trim() === 'Change')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const opened = document.querySelector('.lc-teammatemodel__picker .lc-picker') !== null
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return JSON.stringify({ opened, pickerAfter: document.querySelector('.lc-teammatemodel__picker .lc-picker') !== null, dialogAfter: document.querySelector('.lc-dialog') !== null })
  })()`)
  check('Change opens the chat’s picker in the dialog; Escape closes the picker, not the dialog', escaped.opened && !escaped.pickerAfter && escaped.dialogAfter, JSON.stringify(escaped))
  await drive.capture('Change: the chat’s own picker, open in the dialog', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-teammatemodel button')].find((b) => b.textContent.trim() === 'Change')?.click()
    await new Promise((r) => setTimeout(r, 500))
    document.querySelector('.lc-teammatemodel__picker')?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    return document.querySelector('.lc-teammatemodel__picker .lc-picker') ? 'picker open' : 'no picker'
  })()`))
  const picked = String(await drive.capture('picked: the row names the new model', () => drive.evaluate(`(async () => {
    const picker = document.querySelector('.lc-teammatemodel__picker .lc-picker')
    const input = picker?.querySelector('.lc-picker__input')
    if (!input) return 'no picker'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'free')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    let target
    for (let i = 0; i < 40 && !target; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        if (row && !row.disabled && /opencode/i.test(group) && /free/i.test(row.innerText)) { target = row; break }
      }
    }
    if (!target) return 'no free OpenCode row'
    target.click()
    await new Promise((r) => setTimeout(r, 400))
    return document.querySelector('.lc-teammatemodel__name')?.textContent.trim() ?? 'no row'
  })()`)))
  check('picking a model shows it on the row, the picker closed', /^OpenCode \//.test(picked) && !(await json(MODEL_ROW)).picker, picked)
  await drive.evaluate(`(async () => { [...document.querySelectorAll('.lc-dialog button')].find((b) => b.textContent.trim() === 'Save changes')?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  const chip = String(await drive.evaluate(`(async () => {
    ${teammateFace('Wren')}?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return ([...document.querySelectorAll('button.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })()`))
  check('saved: the chat box, on Wren, now reads OpenCode', /^OpenCode/.test(chip), chip)

  // --- Two words on the updates switch (a packaged build only: a development build cannot update itself).
  if (packaged !== undefined) {
    const lane = await json(`(async () => {
      ;[...document.querySelectorAll('button')].find((b) => /^Settings/.test(b.textContent.trim()))?.click()
      await new Promise((r) => setTimeout(r, 800))
      ;[...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === 'General')?.click()
      await new Promise((r) => setTimeout(r, 800))
      const toggle = document.querySelector('button[role="switch"][aria-label="Beta builds"]')
      return JSON.stringify({ toggle: toggle !== null, note: toggle?.closest('.lc-settingrow')?.querySelector('.lc-settings__note')?.textContent.trim() ?? null })
    })()`)
    await drive.capture('Settings > Updates: Beta builds', () => drive.evaluate(`document.querySelector('button[role="switch"][aria-label="Beta builds"]')?.closest('.lc-settingrow')?.innerText ?? 'no row'`))
    check('the updates switch reads "Beta builds" and nothing more', lane.toggle && lane.note === 'Beta builds', JSON.stringify(lane))
  }
  handover = await drive.finish({ intro: 'Wren (Codex / GPT-6-Luna) has their model changed from their Edit dialog; the + menu and the updates switch looked at. Sends nothing.', last: false })
} catch (error) {
  say(`first launch failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (handover !== undefined) {
  try {
    drive = await launch({ profilePath: handover.profile, stepFrom: handover.step })
    await drive.ready()
    await drive.resize(1215, 800)
    await sleep(2500)
    check('opened again: Edit still opens', String(await drive.evaluate(openEdit)) === 'open')
    const kept = await json(MODEL_ROW)
    await drive.capture('opened again: Wren’s Model row', () => drive.evaluate(MODEL_ROW))
    check('opened again: the model picked in the dialog was kept', /^OpenCode \//.test(kept.name ?? ''), JSON.stringify(kept))
  } catch (error) {
    say(`second launch failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
say(failures === 0 ? '\nTEAMMATE MODEL PASSED' : `\nTEAMMATE MODEL: ${String(failures)} FAILED`)
await drive.finish({ intro: 'Opened again on the same profile: is the model picked in the dialog still theirs?' })
