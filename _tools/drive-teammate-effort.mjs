// A teammate's own effort, set from their Edit dialog.
//
//   node _tools/drive-teammate-effort.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-24: "also for model picker in edit teammate we need to be able
// to choose effort too". Wren is on Codex / GPT-6-Luna at low. The dialog is
// opened the way a person opens it (right-click the face, Edit), the effort
// slider's last dot pressed with the real mouse, and the dialog saved. Then
// the chat box on Wren, and the dialog again after the app is opened again on
// the same profile, must both say that level. Sends nothing; no run starts.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `teammate-effort-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-teammate-effort-ws-')
const launch = (more) => startDrive({
  name: `teammate-effort-${tag}`,
  port: 9549,
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
const mouse = (type, x, y) => drive.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })

const openEdit = `(async () => {
  const face = ${teammateFace('Wren')}
  if (!face) return 'no face'
  const box = face.getBoundingClientRect()
  face.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 }))
  await new Promise((r) => setTimeout(r, 400))
  const edit = [...document.querySelectorAll('.lc-context__item')].find((b) => /^Edit/.test(b.textContent.trim()))
  if (!edit) return 'no Edit item'
  edit.click()
  await new Promise((r) => setTimeout(r, 800))
  document.querySelector('.lc-teammatemodel__effort')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return document.querySelector('.lc-dialog[aria-label="Edit teammate"]') ? 'open' : 'no dialog'
})()`
const EFFORT = `(() => {
  const panel = document.querySelector('.lc-dialog .lc-teammatemodel__effort')
  if (!panel) return JSON.stringify({ panel: false })
  const dots = [...panel.querySelectorAll('.lc-effortpanel__notch')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  return JSON.stringify({ panel: true, level: panel.querySelector('.lc-effortpanel__now')?.textContent.trim() ?? null, dots })
})()`

let handover
try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(2500)
  check('Edit opens from the right-click menu', String(await drive.evaluate(openEdit)) === 'open')
  const before = await json(EFFORT)
  await drive.capture('Edit Wren: the effort row, at their saved level', () => drive.evaluate(EFFORT))
  check('the dialog shows an effort control, at Wren’s saved level', before.panel && before.level === 'Low', JSON.stringify({ panel: before.panel, level: before.level, stops: before.dots?.length }))
  if (before.panel && before.dots.length > 1) {
    const last = before.dots[before.dots.length - 1]
    await mouse('mousePressed', last.x, last.y)
    await mouse('mouseReleased', last.x, last.y)
    await sleep(700)
  }
  const moved = await json(EFFORT)
  await drive.capture('the last dot pressed with the mouse', () => drive.evaluate(EFFORT))
  check('pressing the last dot moves it to the model’s top level', moved.panel && moved.level !== 'Low' && moved.level !== null, String(moved.level))
  await drive.evaluate(`(async () => { [...document.querySelectorAll('.lc-dialog button')].find((b) => b.textContent.trim() === 'Save changes')?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  const chip = String(await drive.capture('saved: the chat box on Wren', () => drive.evaluate(`(async () => {
    ${teammateFace('Wren')}?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return (document.querySelector('button[aria-label="Reasoning effort"]')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })()`)))
  check('saved: the chat box on Wren says that level', chip === moved.level, `chip "${chip}", dialog "${String(moved.level)}"`)
  handover = await drive.finish({ intro: 'Wren (Codex / GPT-6-Luna, low) has their effort changed from their Edit dialog with the mouse. Sends nothing.', last: false })
  handover.level = moved.level
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
    const kept = await json(EFFORT)
    await drive.capture('opened again: Wren’s effort row', () => drive.evaluate(EFFORT))
    check('opened again: the level set in the dialog was kept', kept.level === handover.level, `${String(kept.level)} (set: ${String(handover.level)})`)
  } catch (error) {
    say(`second launch failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
say(failures === 0 ? '\nTEAMMATE EFFORT PASSED' : `\nTEAMMATE EFFORT: ${String(failures)} FAILED`)
await drive.finish({ intro: 'Opened again on the same profile: is the effort set in the dialog still theirs?' })
