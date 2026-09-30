// Each compared model has its own effort (0.490).
//
//   node _tools/drive-compare-effort.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: "still no effort control for compare". Sets up a
// comparison from the chat mode chip, reads each column's chip, opens one
// column's effort, moves it, and checks the chip says so and the panel stays
// in the window -- at 1120 and 1440 wide. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('compare-effort-2026-09-30'), `compare-effort-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-effort-ws-')
const drive = await startDrive({
  name: `compare-effort-${tag}`, port: 9793, workspace, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const SLOTS = `(() => {
  const groups = [...document.querySelectorAll('.lc-slotgroup')]
  const send = document.querySelector('form.command-dock .lc-send')?.getBoundingClientRect()
  const panel = document.querySelector('.lc-compare-slots .lc-effortpanel')?.getBoundingClientRect()
  return JSON.stringify({
    width: innerWidth,
    slots: groups.map((group) => {
      const model = group.querySelector('.lc-control--slot')
      const effort = group.querySelector('.lc-control--sloteffort')
      const m = model.getBoundingClientRect()
      const e = effort?.getBoundingClientRect()
      return {
        model: model.innerText.trim(),
        effort: effort?.innerText.trim() ?? null,
        joined: e === undefined ? null : Math.abs(e.left - m.right) <= 1.5 && Math.abs(e.top - m.top) <= 1,
        right: Math.round((e ?? m).right)
      }
    }),
    sendLeft: send === undefined ? null : Math.round(send.left),
    panel: panel === undefined ? null : { left: Math.round(panel.left), right: Math.round(panel.right), top: Math.round(panel.top) },
    panelNow: document.querySelector('.lc-compare-slots .lc-effortpanel__now')?.innerText.trim() ?? null
  })
})()`

try {
  await drive.ready()
  for (const [w, h] of [[1120, 720], [1440, 900]]) {
    await drive.resize(w, h)
    await sleep(3500)
    const started = String(await drive.evaluate(`(async () => {
      if (document.querySelector('.lc-slotgroup')) return 'already comparing'
      const chip = document.querySelector('.lc-control--chatmode')
      if (!chip) return 'no chat mode chip'
      chip.click()
      await new Promise((r) => setTimeout(r, 400))
      const item = [...document.querySelectorAll('[role="menu"][aria-label="Direct or compare"] [role="menuitemradio"], [role="menu"][aria-label="Direct or compare"] button')].find((b) => /^Compare/.test(b.innerText.trim()))
      if (!item) return 'no Compare item'
      item.click()
      await new Promise((r) => setTimeout(r, 900))
      const done = [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')
      if (done && !done.disabled) done.click()
      await new Promise((r) => setTimeout(r, 500))
      return document.querySelector('.lc-slotgroup') ? 'comparing' : 'no slots: ' + (document.querySelector('.lc-picker') ? 'picker open' : 'nothing')
    })()`))
    say(`  ${String(w)}: ${started}`)
    const before = JSON.parse(String(await drive.capture(`${String(w)}: two models, each with its own effort`, () => drive.evaluate(SLOTS))))
    say(`  slots: ${JSON.stringify(before)}`)
    check(`${String(w)}: at least one compared model shows its effort, joined to its chip`, before.slots.some((slot) => slot.effort !== null && slot.joined === true), JSON.stringify(before.slots))
    check(`${String(w)}: the chips stop before the send button`, before.sendLeft === null || before.slots.every((slot) => slot.right <= before.sendLeft), JSON.stringify(before))
    const index = before.slots.findIndex((slot) => slot.effort !== null)
    if (index < 0) continue
    const moved = JSON.parse(String(await drive.evaluate(`(async () => {
      const effort = document.querySelectorAll('.lc-slotgroup')[${String(index)}].querySelector('.lc-control--sloteffort')
      effort.click()
      await new Promise((r) => setTimeout(r, 500))
      const input = document.querySelector('.lc-compare-slots .lc-effortpanel__slider')
      if (!input) return JSON.stringify({ opened: false })
      const from = input.value
      const to = input.value === '0' ? input.max : '0'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, to)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 500))
      return JSON.stringify({ opened: true, from, to })
    })()`)))
    const after = JSON.parse(String(await drive.capture(`${String(w)}: one column's effort moved`, () => drive.evaluate(SLOTS))))
    say(`  moved: ${JSON.stringify(moved)} -> ${JSON.stringify(after)}`)
    check(`${String(w)}: the panel opens for that column`, moved.opened === true && after.panel !== null)
    check(`${String(w)}: the panel stays inside the window`, after.panel !== null && after.panel.left >= 0 && after.panel.right <= after.width && after.panel.top >= 0, JSON.stringify(after.panel))
    check(`${String(w)}: that column's chip says the new level, and only that column's`,
      after.slots[index].effort !== before.slots[index].effort && after.slots[index].effort === after.panelNow &&
      after.slots.every((slot, at) => at === index || slot.effort === before.slots[at].effort),
      `${before.slots[index].effort} -> ${after.slots[index].effort} (panel ${after.panelNow})`)
    await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    await sleep(400)
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A comparison set up from the chat mode chip; one column's effort moved. Sends nothing.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
