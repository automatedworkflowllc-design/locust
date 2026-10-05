// Keep carries the whole choice: the kept column's effort, and the chat box's own mode (0.622).
//
//   LOCUST_SPEND=1 node _tools/drive-compare-keep-mode.mjs [--auto] [--packaged <exe>] [--tag <name>]
//
// Arena round 2's reveal: "You kept Sonnet 5.5 · High; the conversation carries on with it" over a
// chat box that said Medium, and over a mode the comparison had not run in. Claude Code / Haiku 4.5 at
// Low against Sonnet 5.5 at High, asked "name three prime numbers" (no files; a few cents of Claude);
// the chat box is in Edit before the comparison is opened. The High column is kept: the chat box must
// read High and Edit, and the bar's sentence, opened again from the conversation, must say the same.
// --auto: the comparison itself runs in Auto (in copies), the case the sentence must not blur.

import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const AUTO = process.argv.includes('--auto')
const OUT = join(recordRoot('compare-keep-mode-2026-10-05'), `compare-keep-mode-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-keep-mode-ws-')
const PROFILE = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-compare-keep-mode-profile-'))
const drive = await startDrive({
  name: `compare-keep-mode-${tag}`, port: 9794, workspace, profilePath: PROFILE, outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: AUTO } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const flat = `.replace(/\\s+/g, ' ').trim()`
const MODE_CHIP = `(document.querySelector('button[aria-label="Permission mode"]')?.innerText ?? '')${flat}`
const EFFORT_CHIP = `(() => { const b = [...document.querySelectorAll('button.lc-control')].find((c) => c.querySelector('.lc-control__effort')); return b ? b.innerText${flat} : '' })()`
// The picker refuses one model twice ("Already in this comparison"), so two Claude Code models, one at each level.
const LEVELS = [
  { level: 'Low', effort: 'low', search: 'haiku', row: 'Haiku 4\\.5', name: 'Haiku' },
  { level: 'High', effort: 'high', search: 'sonnet', row: 'Sonnet 5\\.5', name: 'Sonnet' }
]

try {
  await drive.ready()
  const modeBefore = String(await drive.evaluate(MODE_CHIP))
  check('the chat box is in Edit before the comparison is opened', /^Edit\b/i.test(modeBefore), modeBefore)

  const started = String(await drive.evaluate(`(async () => {
    const chip = document.querySelector('.lc-control--chatmode')
    if (!chip) return 'no chat mode chip'
    chip.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role="menu"][aria-label="Direct or compare"] button')].find((b) => /^Compare/.test(b.innerText.trim()))
    if (!item) return 'no Compare item'
    item.click()
    await new Promise((r) => setTimeout(r, 900))
    const done = [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')
    if (done && !done.disabled) done.click()
    await new Promise((r) => setTimeout(r, 500))
    return document.querySelector('.lc-slotgroup') ? 'comparing' : 'no slots'
  })()`))
  check('a comparison is set up', started === 'comparing', started)

  const set = []
  for (const [index, want] of LEVELS.entries()) {
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
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && new RegExp(${JSON.stringify(want.row)}, 'i').test(one.querySelector('.lc-picker__label')?.textContent ?? ''))
      if (!row) return JSON.stringify({ picked: false, why: 'no row' })
      row.click()
      await new Promise((r) => setTimeout(r, 600))
      const group = document.querySelectorAll('.lc-slotgroup')[${String(index)}]
      group.querySelector('.lc-control--sloteffort')?.click()
      await new Promise((r) => setTimeout(r, 500))
      const input = document.querySelector('.lc-compare-slots .lc-effortpanel__slider')
      if (!input) return JSON.stringify({ picked: true, effort: false })
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (let stop = 0; stop <= Number(input.max); stop += 1) {
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
  check('Haiku 4.5 at Low and Sonnet 5.5 at High', set.every((one, at) => one.picked && one.chip?.includes(LEVELS[at].name) && one.chip.includes(LEVELS[at].level)), JSON.stringify(set))

  if (AUTO) {
    const mode = String(await drive.evaluate(`(async () => {
      document.querySelector('button[aria-label="Permission mode"]')?.click()
      await new Promise((r) => setTimeout(r, 400))
      const auto = [...document.querySelectorAll('[role="menu"][aria-label="What the comparison does"] [role="menuitemradio"]')].find((b) => /^Auto/.test(b.innerText.trim()))
      if (!auto) return 'no Auto'
      auto.click()
      await new Promise((r) => setTimeout(r, 400))
      return ${MODE_CHIP}
    })()`))
    check('the comparison is set to run in Auto', /Auto/.test(mode), mode)
  }

  await drive.capture('Sent: name three prime numbers', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'name three prime numbers')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Send"]')?.click()
    for (let i = 0; i < 360; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
      if (i > 6 && states.length === 2 && states.every((state) => state === 'done')) break
    }
    return 'settled'
  })()`))
  const heads = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()))`)))
  say(`  heads: ${JSON.stringify(heads)}`)
  check('both columns answered and are named with their level', heads.length === 2 && heads[0].includes('Haiku') && heads[0].includes('Low') && heads[1].includes('Sonnet') && heads[1].includes('High') && heads.every((head) => /done/.test(head)), JSON.stringify(heads))

  // Keep the High column: the second one.
  const kept = String(await drive.capture('Kept the High column', () => drive.evaluate(`(async () => {
    const keep = [...document.querySelectorAll('.lc-compare__foot button')].filter((b) => b.innerText.trim() === 'Keep this one').at(-1)
    if (!keep) return 'no keep'
    keep.click()
    for (let i = 0; i < 40 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'nothing said'
  })()`)))
  const effortChip = String(await drive.evaluate(EFFORT_CHIP))
  const modeAfter = String(await drive.evaluate(MODE_CHIP))
  say(`  kept: ${kept}; the chat box: effort "${effortChip}", mode "${modeAfter}"`)
  check("the chat box's effort is the kept column's: High", /\bHigh\b/i.test(effortChip), effortChip)
  check("the chat box is still in Edit, not the comparison's mode", /^Edit\b/i.test(modeAfter), modeAfter)

  const bar = String(await drive.capture("The comparison's bar, opened again", () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compared__open')?.click()
    await new Promise((r) => setTimeout(r, 900))
    return document.querySelector('.lc-compare__bar span')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no bar'
  })()`)))
  say(`  bar: ${bar}`)
  check('the bar says which model, and the mode the conversation is in', /You kept .*High.*; the conversation carries on with it in Edit/.test(bar), bar)
  if (AUTO) check('and, after an Auto comparison, that it is not Auto', /not in Auto/.test(bar), bar)
  else check('and promises no Auto it did not run in', !/Auto/.test(bar), bar)
  await drive.evaluate(`document.querySelector('.lc-compare__bar .lc-button')?.click()`)
  await sleep(600)

  // The comparison's record and the chat box agree: the kept slot ran at High.
  const record = JSON.parse(await readFile(join(PROFILE, 'compares.json'), 'utf8'))
  const last = (record.compares ?? record).at?.(-1)
  const route = last?.slots?.find((slot) => slot.slot === last.kept?.slot)?.route
  say(`  record: ${JSON.stringify(route)}`)
  check("the record's kept route is Sonnet at High, as the chat box says", route?.effort === 'high' && /sonnet/i.test(route?.model ?? ''), JSON.stringify(route))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Claude Code / Haiku 4.5 at Low against Sonnet 5.5 at High${AUTO ? ', the comparison in Auto' : ''}; the High column kept from a chat box in Edit.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
