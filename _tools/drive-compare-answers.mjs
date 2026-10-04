// Compare models side by side, phase one: answers (0.441).
//
//   node _tools/drive-compare-answers.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// Colin, 2026-09-28: "whats the best way to implement a "compare" mode, maybe a
// side by side ... compare work between different models", and his bar: "if
// we cant make it clean and seamless, we dont do it". In Wren's conversation:
// the picker's Compare switch, two free models ticked, the chip reading
// "A vs B"; one ask answered in two columns with time and cost; one sidebar
// row for the comparison; a follow-up that goes to both; Keep this one
// leaving an ordinary conversation that says what it was compared with and
// opens the comparison again.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
// Two models, each `search=>row pattern` (a regular expression over the picker's row label).
// The first run's second free pick (Ling) had its provider down; OpenCode's free tier rate-limits too.
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'free=>nemotron-3-ultra|Nemotron 3 Ultra,free=>mimo-v2\\.6-flash|MiMo V2\\.6 Flash').split(',').map((spec) => {
  const [search, row] = spec.includes('=>') ? spec.split('=>') : ['free', spec]
  return { search, row }
})
const SPENDS = PICKS.some((pick) => pick.search !== 'free')
const OUT = join(recordRoot('compare-answers-2026-09-28'), `compare-answers-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-ws-')
const drive = await startDrive({
  name: `compare-answers-${tag}`, port: 9776, workspace, outPath: OUT, spends: SPENDS,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'violet', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const typeAndSend = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const placeholder = field.getAttribute('placeholder') ?? ''
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  const button = document.querySelector('button[aria-label="Send"]')
  const could = button !== null && !button.disabled
  button?.click()
  return JSON.stringify({ placeholder, could })
})()`
/** Until every column has finished (or ten minutes pass), then what the comparison shows. */
const settled = (turns) => `(async () => {
  for (let i = 0; i < 760; i += 1) { // under the 400s an evaluate is given: a stall reports, not crashes
    await new Promise((r) => setTimeout(r, 500))
    const view = document.querySelector('.lc-compare')
    if (!view) continue
    const states = [...view.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
    const asked = view.querySelectorAll('.lc-compare__turn').length
    if (i > 6 && asked >= ${String(turns)} && states.length > 0 && states.every((state) => state !== 'working' && state !== 'waiting')) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  const view = document.querySelector('.lc-compare')
  const rows = [...document.querySelectorAll('.lc-conv')]
  return JSON.stringify({
    open: view !== null,
    heads: [...(view?.querySelectorAll('.lc-compare__head') ?? [])].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
    turns: view?.querySelectorAll('.lc-compare__turn').length ?? 0,
    cells: [...(view?.querySelectorAll('.lc-compare__cell') ?? [])].map((el) => el.innerText.replace(/\\s+/g, ' ').trim().length),
    feet: [...(view?.querySelectorAll('.lc-compare__foot') ?? [])].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
    rows: rows.length,
    vsRows: rows.filter((row) => row.querySelector('.lc-conv__vs')).length
  })
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  // 1. Compare, chosen in the chat mode chip. It opens a picker to tick two or three models
  // ("Pick two or three models"), then Done; with models already ticked it goes straight to a
  // chip per column. Both are handled: ticks in the picker, else a pick in each column's chip.
  const entered = JSON.parse(String(await drive.evaluate(`(async () => {
    const chip = document.querySelector('.lc-control--chatmode')
    if (!chip) return JSON.stringify({ how: 'no chat mode chip' })
    chip.click()
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role="menu"][aria-label="Direct or compare"] [role="menuitemradio"], [role="menu"][aria-label="Direct or compare"] button')].find((b) => /^Compare/.test(b.innerText.trim()))
    if (!item) return JSON.stringify({ how: 'no Compare item' })
    item.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 150))
      if (document.querySelector('.lc-picker__input')) return JSON.stringify({ how: 'picker' })
      if (document.querySelector('.lc-slotgroup')) return JSON.stringify({ how: 'columns' })
    }
    return JSON.stringify({ how: 'neither a picker nor columns' })
  })()`)))
  check('the chat mode chip switches to Compare', entered.how === 'picker' || entered.how === 'columns', entered.how)
  const labels = []
  for (const [index, pick] of PICKS.entries()) {
    const got = JSON.parse(String(await drive.evaluate(`(async () => {
      const inPicker = document.querySelector('.lc-picker__input') !== null
      if (!inPicker) {
        const chip = document.querySelectorAll('.lc-slotgroup')[${String(index)}]?.querySelector('.lc-control--slot')
        if (!chip) return JSON.stringify({ picked: false, why: 'no column chip' })
        chip.click()
        for (let i = 0; i < 20 && !document.querySelector('.lc-picker__input'); i += 1) await new Promise((r) => setTimeout(r, 150))
      }
      const box = document.querySelector('.lc-picker__input')
      if (!box) return JSON.stringify({ picked: false, why: 'no search box' })
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, ${JSON.stringify(pick.search)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      const wanted = new RegExp(${JSON.stringify(pick.row)}, 'i')
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && wanted.test(one.querySelector('.lc-picker__label')?.textContent ?? ''))
      if (!row) return JSON.stringify({ picked: false, why: 'no row', inPicker })
      const label = row.querySelector('.lc-picker__label')?.textContent.trim() ?? ''
      row.click()
      await new Promise((r) => setTimeout(r, 500))
      return JSON.stringify({ picked: true, label, inPicker })
    })()`)))
    say(`  pick ${String(index + 1)}: ${JSON.stringify(got)}`)
    if (got.picked) labels.push(got.label)
  }
  const columns = JSON.parse(String(await drive.capture('Compare, two models picked', () => drive.evaluate(`(async () => {
    const foot = document.querySelector('.lc-picker__foot--compare')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    const done = [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')
    if (done && !done.disabled) done.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-slotgroup'); i += 1) await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => setTimeout(r, 400))
    const chips = [...document.querySelectorAll('.lc-slotgroup .lc-control--slot')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ foot, chips })
  })()`))))
  say(`  columns: ${JSON.stringify(columns)}`)
  check('two models picked, a chip per column naming each', labels.length === 2 && columns.chips.length === 2 && labels.every((label) => columns.chips.some((chip) => chip.replace(/[\s-]+/g, ' ').includes(label.replace(/[\s-]+/g, ' ')))), JSON.stringify({ labels, columns }))

  // 2. One ask, two columns.
  say(`  ${String(await drive.evaluate(typeAndSend('In one sentence: what does a git worktree let you do?')))}`)
  const first = JSON.parse(String(await drive.capture('Two columns, both answered', () => drive.evaluate(settled(1)))))
  say(`  first: ${JSON.stringify(first)}`)
  check('the comparison takes the thread\'s place, a column per model', first.open && first.heads.length === 2, JSON.stringify(first.heads))
  check('both columns answered, and finished', first.cells.length === 2 && first.cells.every((length) => length > 20) && first.heads.every((head) => / done$/.test(head)), JSON.stringify(first.heads))
  check('each foot says how long it took, and offers Keep this one', first.feet.length === 2 && first.feet.every((foot) => /\d+s|\dm/.test(foot) && /Keep this one/.test(foot)), JSON.stringify(first.feet))
  check('the sidebar lists the comparison once, marked vs', first.vsRows === 1 && first.rows === 1, `${String(first.rows)} rows, ${String(first.vsRows)} vs`)

  // 3. A follow-up goes to both.
  const followUp = JSON.parse(String(await drive.evaluate(typeAndSend('Now say it in five words.'))))
  check('the box asks both', followUp.placeholder.startsWith('Ask both') && followUp.could, JSON.stringify(followUp))
  const second = JSON.parse(String(await drive.capture('The follow-up, answered in both columns', () => drive.evaluate(settled(2)))))
  say(`  second: ${JSON.stringify(second)}`)
  check('the follow-up lines up under the first, answered in both', second.turns === 2 && second.cells.length === 4 && second.cells.every((length) => length > 0) && second.heads.every((head) => / done$/.test(head)), JSON.stringify(second.heads))

  // 4. Keep the first.
  const kept = JSON.parse(String(await drive.capture('Kept the first: an ordinary conversation', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
    for (let i = 0; i < 40 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({
      compareGone: document.querySelector('.lc-compare') === null,
      compared: document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      thread: (document.querySelector('.lc-thread')?.innerText ?? '').length,
      vsRows: [...document.querySelectorAll('.lc-conv')].filter((row) => row.querySelector('.lc-conv__vs')).length,
      rows: document.querySelectorAll('.lc-conv').length,
      slots: document.querySelectorAll('.lc-slotgroup').length,
      placeholder: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''
    })
  })()`))))
  say(`  kept: ${JSON.stringify(kept)}`)
  check('keeping one leaves an ordinary conversation, saying what it was compared with', kept.compareGone && kept.thread > 40 && /^Compared with .+\. Open the comparison$/.test(kept.compared), JSON.stringify(kept))
  check('the sidebar row is now an ordinary conversation, still one row', kept.vsRows === 0 && kept.rows === 1, JSON.stringify(kept))
  check('the composer is back to one model', kept.slots === 0 && kept.placeholder.startsWith('Message Wren'), JSON.stringify(kept))

  // 5. The comparison, one click away.
  const again = JSON.parse(String(await drive.capture('Opened again from the conversation', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compared__open')?.click()
    await new Promise((r) => setTimeout(r, 900))
    const view = document.querySelector('.lc-compare')
    const out = {
      open: view !== null,
      bar: view?.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      kept: view?.querySelectorAll('.lc-compare__kept').length ?? 0,
      keepButtons: view?.querySelectorAll('.lc-compare__foot .lc-primarybutton').length ?? 0
    }
    ;[...(view?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Back to the conversation')?.click()
    await new Promise((r) => setTimeout(r, 600))
    out.back = document.querySelector('.lc-compare') === null && document.querySelector('.lc-thread') !== null
    return JSON.stringify(out)
  })()`))))
  say(`  again: ${JSON.stringify(again)}`)
  check('"Open the comparison" shows it again, the kept column marked, no Keep buttons', again.open && again.kept === 1 && again.keepButtons === 0 && /You kept/.test(again.bar), JSON.stringify(again))
  check('and "Back to the conversation" returns to it', again.back === true, JSON.stringify(again))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on OpenCode free models, Ask; a comparison of two free models.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
