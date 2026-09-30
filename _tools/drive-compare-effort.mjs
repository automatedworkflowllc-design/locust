// Each compared model has its own effort (0.490).
//
//   node _tools/drive-compare-effort.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: "still no effort control for compare". Sets up a
// comparison from the chat mode chip, reads each column's chip, opens one
// column's effort, moves it, and checks the chip says so and the panel stays
// in the window -- at 1120 and 1440 wide. Sends nothing.

import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execFileSync } from 'node:child_process'
import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// --send: two free OpenCode models that list levels, each at its own; spends nothing.
const SEND = process.argv.includes('--send') || process.argv.includes('--changes')
// --changes: the two models change the project, in Auto, in a git folder (Sol, 0.491: a column wrote to
// the real folder). Checks the folder is untouched before Keep and no column works inside it.
const CHANGES = process.argv.includes('--changes')
const FREE = [
  { search: 'muse', row: '/Muse Spark.*(Contributor|Free)/i', level: 'Low', effort: 'low', model: /muse-spark/ },
  { search: 'bunny', row: '/Space Bunny/i', level: 'Max', effort: 'max', model: /space-bunny/ }
]
const OUT = join(recordRoot('compare-effort-2026-09-30'), `compare-effort-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-effort-ws-')
const PROFILE = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-compare-effort-profile-'))
const drive = await startDrive({
  name: `compare-effort-${tag}`, port: 9793, workspace, profilePath: PROFILE, outPath: OUT, ...(SEND ? {} : { sendsNothing: true }),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: CHANGES } }
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
    // Every control on the composer row, left to right: none may sit on another (Sol, 0.491 at 1215).
    overlaps: (() => {
      const row = [...document.querySelectorAll('form.command-dock .lc-control, form.command-dock .lc-send')]
        .filter((el) => el.offsetParent !== null && !el.closest('.lc-menu'))
        .map((el) => ({ label: (el.getAttribute('aria-label') ?? el.innerText).trim().slice(0, 30), box: el.getBoundingClientRect() }))
      const hits = []
      for (let i = 0; i < row.length; i += 1) for (let j = i + 1; j < row.length; j += 1) {
        const a = row[i].box, b = row[j].box
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(row[i].label + ' [' + Math.round(a.left) + '-' + Math.round(a.right) + '] / ' + row[j].label + ' [' + Math.round(b.left) + '-' + Math.round(b.right) + ']')
      }
      return hits
    })(),
    panel: panel === undefined ? null : { left: Math.round(panel.left), right: Math.round(panel.right), top: Math.round(panel.top) },
    panelNow: document.querySelector('.lc-compare-slots .lc-effortpanel__now')?.innerText.trim() ?? null
  })
})()`

try {
  await drive.ready()
  for (const [w, h] of [[1120, 720], [1215, 800], [1440, 900]]) {
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
    check(`${String(w)}: no control on the row sits on another`, before.overlaps.length === 0, JSON.stringify(before.overlaps))
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
  if (SEND) {
    /*
     * THE ROUND TRIP, on two free models that list levels: each column is
     * set to its own level, the ask is sent, and the ledger each run wrote is
     * read back for the level it was started with.
     */
    const set = []
    for (const [index, want] of FREE.entries()) {
      set.push(JSON.parse(String(await drive.evaluate(`(async () => {
        const chip = document.querySelectorAll('.lc-slotgroup')[${String(index)}]?.querySelector('.lc-control--slot')
        if (!chip) return JSON.stringify({ picked: false, why: 'no chip' })
        chip.click()
        await new Promise((r) => setTimeout(r, 600))
        const box = document.querySelector('.lc-picker__input')
        if (box) {
          const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
          setInput.call(box, ${JSON.stringify(want.search)})
          box.dispatchEvent(new Event('input', { bubbles: true }))
          await new Promise((r) => setTimeout(r, 700))
        }
        const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && ${want.row}.test(one.querySelector('.lc-picker__label')?.textContent ?? ''))
        if (!row) return JSON.stringify({ picked: false, why: 'no row' })
        row.click()
        await new Promise((r) => setTimeout(r, 600))
        const group = document.querySelectorAll('.lc-slotgroup')[${String(index)}]
        group.querySelector('.lc-control--sloteffort')?.click()
        await new Promise((r) => setTimeout(r, 500))
        const input = document.querySelector('.lc-compare-slots .lc-effortpanel__slider')
        if (!input) return JSON.stringify({ picked: true, effort: false })
        const stops = [...Array(Number(input.max) + 1).keys()]
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        for (const stop of stops) {
          setter.call(input, String(stop))
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await new Promise((r) => setTimeout(r, 200))
          if ((document.querySelector('.lc-compare-slots .lc-effortpanel__now')?.innerText.trim() ?? '') === ${JSON.stringify(want.level)}) break
        }
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 300))
        return JSON.stringify({ picked: true, chip: group.innerText.replace(/\\s+/g, ' ').trim() })
      })()`))))
    }
    say(`  set: ${JSON.stringify(set)}`)
    check('both free models picked, each at its own level', set.every((one, at) => one.picked && one.chip?.includes(FREE[at].level)), JSON.stringify(set))
    if (CHANGES) {
      const mode = String(await drive.evaluate(`(async () => {
        document.querySelector('button[aria-label="Permission mode"]')?.click()
        await new Promise((r) => setTimeout(r, 400))
        const auto = [...document.querySelectorAll('[role="menu"][aria-label="What the comparison does"] [role="menuitemradio"]')].find((b) => /^Auto/.test(b.innerText.trim()))
        if (!auto) return 'no Auto'
        auto.click()
        await new Promise((r) => setTimeout(r, 400))
        return document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '?'
      })()`))
      check('the comparison is set to change files, in Auto', /Auto/.test(mode), mode)
    }
    const README = CHANGES ? execFileSync('git', ['show', 'HEAD:README.md'], { cwd: workspace, encoding: 'utf8' }) : ''
    const answered = JSON.parse(String(await drive.capture('Sent: each column at its own level', () => drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, ${JSON.stringify(CHANGES ? 'Add one line at the very end of README.md that says: Dark mode: on. Work only in this folder.' : 'Reply with the single word: ok')})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      document.querySelector('button[aria-label="Start mission"]')?.click()
      for (let i = 0; i < 600; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
        if (i > 6 && states.length === 2 && states.every((state) => state !== 'working' && state !== 'waiting')) break
      }
      return JSON.stringify({ heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()) })
    })()`))))
    say(`  answered: ${JSON.stringify(answered)}`)
    check('each column is named with its level', FREE.every((want) => answered.heads.some((head) => head.includes(want.level))), JSON.stringify(answered.heads))
    // The comparison's own record is what each column is started from (the ledger keeps no effort).
    const record = JSON.parse(await readFile(join(PROFILE, 'compares.json'), 'utf8'))
    const slots = (record.compares ?? record).at?.(-1)?.slots ?? []
    const started = slots.map((slot) => ({ model: slot.route.model, effort: slot.route.effort, ran: slot.missionIds.length }))
    say(`  started with: ${JSON.stringify(started)}`)
    check('each column was started at its own level', FREE.every((want) => started.some((run) => want.model.test(run.model) && run.effort === want.effort && run.ran > 0)), JSON.stringify(started))
    if (CHANGES) {
      const flat = (path) => path.replace(/\\/g, '/').toLowerCase()
      const trees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
        .split(/\r?\n/).filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length).trim())
        .filter((path) => flat(path) !== flat(workspace))
      const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
      say(`  columns work in: ${JSON.stringify(trees)}`)
      check('no column works inside the folder', trees.length === 2 && trees.every((path) => !flat(path).startsWith(`${flat(workspace)}/`)), JSON.stringify(trees))
      check("the folder's own README is untouched before Keep", status().length === 0 && readFileSync(join(workspace, 'README.md'), 'utf8').replace(/\r/g, '') === README.replace(/\r/g, ''), JSON.stringify(status()))
      const kept = String(await drive.capture('Kept the first column', () => drive.evaluate(`(async () => {
        const keep = document.querySelector('.lc-compare__foot .lc-primarybutton')
        if (!keep) return 'no keep'
        keep.click()
        for (let i = 0; i < 40 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
        await new Promise((r) => setTimeout(r, 1000))
        return document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'nothing said'
      })()`)))
      say(`  kept: ${kept}`)
      check('Keep brings the kept column in: the README now says it', /Dark mode: on/i.test(readFileSync(join(workspace, 'README.md'), 'utf8')) && status().some((line) => /README\.md/.test(line)), JSON.stringify({ status: status(), said: kept }))
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A comparison set up from the chat mode chip; one column's effort moved. Sends nothing.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
