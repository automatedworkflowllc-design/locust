// The runtimes wear their marks (0.383).
//
//   node _tools/drive-runtime-marks.mjs [--packaged <exe>] [--tag <name>]
//
// Six teammates on six runtimes -- Wren on Claude, Juno on Codex, Quill on
// Copilot, Pip on Cursor, Sable on OpenCode's free model, Boss on
// Antigravity's Flash (0.384) -- and each surface that names a runtime,
// photographed: Home (the team's cards and the agents line), the Team board,
// a teammate open (the sidebar's faces and the composer's chip), the model
// picker, and an approval card with the conversation's header over it. Only
// Sable runs anything, on the free model; the other five routes are seeded
// and never started.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('runtime-marks-2026-09-26'), `runtime-marks-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const at = '2026-09-26T05:00:00.000Z'
const mate = (teammateId, name, hue, role, runtime, model) => ({ teammateId, name, hue, role, createdAt: at, route: { runtime, model, mode: 'accept-edits' } })
const SEEDED = { Wren: 'claude', Juno: 'codex', Quill: 'copilot', Pip: 'cursor', Sable: 'opencode', Boss: 'antigravity' }

const workspace = await scratchRepository('locust-runtime-marks-ws-')
const drive = await startDrive({
  name: `runtime-marks-${tag}`,
  port: 9686,
  workspace,
  launchElsewhere: true,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      mate('tm_wren', 'Wren', 'lime', 'Code & Migrations', 'claude', 'sonnet'),
      mate('tm_juno', 'Juno', 'violet', 'Docs & QA', 'codex', 'account-default'),
      mate('tm_quill', 'Quill', 'clay', 'Research & Briefs', 'copilot', 'auto'),
      mate('tm_pip', 'Pip', 'teal', 'Ops & Scheduling', 'cursor', 'auto'),
      mate('tm_sable', 'Sable', 'blue', 'Data & Reporting', 'opencode', MODEL),
      // 0.384: Colin's own Home read "Antigravity · Flash" and "Claude · Opus".
      mate('tm_boss', 'Boss', 'slate', 'Ops & Scheduling', 'antigravity', 'flash')
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
const json = async (expression) => JSON.parse(String(await drive.evaluate(`JSON.stringify(${expression})`)))
/** Each teammate's name, and the mark its route line wears, on the surface `rows` selects. */
const marksBy = (rows, name, mark) => `[...document.querySelectorAll(${JSON.stringify(rows)})].map((row) => [
  row.querySelector(${JSON.stringify(name)})?.textContent.trim().split(/\\s+/)[0] ?? '',
  row.querySelector(${JSON.stringify(mark)})?.getAttribute('data-runtime') ?? null
])`
const shortcut = async (key) => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Digit${key}`, windowsVirtualKeyCode: 48 + Number(key), modifiers: 2 })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Digit${key}`, windowsVirtualKeyCode: 48 + Number(key), modifiers: 2 })
  await sleep(800)
}
const everyoneWearsTheirs = (pairs) => pairs.length > 0 && pairs.every(([name, runtime]) => SEEDED[name] === undefined || SEEDED[name] === runtime)

try {
  await drive.ready()
  await drive.resize(1440, 900)

  // 1. Home: the team's cards, and the agents on this machine.
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  await sleep(1200)
  const home = await json(`{
    cards: ${marksBy('.lc-hometeam__card', '.lc-hometeam__name', '.lc-hometeam__route .lc-runtimemark')},
    // What each card's route line SAYS, beside its mark (0.384).
    lines: Object.fromEntries([...document.querySelectorAll('.lc-hometeam__card')].map((card) => [
      card.querySelector('.lc-hometeam__name')?.textContent.trim().split(/\\s+/)[0] ?? '',
      card.querySelector('.lc-hometeam__route')?.textContent.trim() ?? ''
    ])),
    // The whole route, on hover: with its effort level where the model has one (0.386).
    titles: Object.fromEntries([...document.querySelectorAll('.lc-hometeam__card')].map((card) => [
      card.querySelector('.lc-hometeam__name')?.textContent.trim().split(/\\s+/)[0] ?? '',
      card.querySelector('.lc-hometeam__route')?.getAttribute('title') ?? ''
    ])),
    folded: [...document.querySelectorAll('.lc-agenthead__marks .lc-runtimemark')].map((svg) => svg.getAttribute('aria-label')),
    rows: [...document.querySelectorAll('.lc-runtimecell__name .lc-runtimemark')].map((svg) => svg.getAttribute('data-runtime'))
  }`)
  await drive.capture('Home: the team, and the agents on this machine', () => JSON.stringify(home))
  check('every Home card wears its route’s mark', everyoneWearsTheirs(home.cards) && home.cards.every(([, runtime]) => runtime !== null), JSON.stringify(home.cards))
  check('Home names the model a teammate RUNS: Sonnet 5, Gemini 3.8 Flash -- the mark stands for the runtime', home.lines.Wren === 'Sonnet 5' && home.lines.Boss === 'Gemini 3.8 Flash', JSON.stringify(home.lines))
  // Sonnet reports levels; Antigravity's tiers report none.
  check('the hover names the whole route, with the level where the model has one', /^Claude · Sonnet 5 · [A-Z]/.test(home.titles.Wren ?? '') && home.titles.Boss === 'Antigravity · Gemini 3.8 Flash', JSON.stringify(home.titles))
  check('the agents line shows marks, named, or each agent row has one', home.folded.length > 0 ? home.folded.every((label) => typeof label === 'string' && label.length > 0) : home.rows.length > 0, JSON.stringify(home))

  // 2. The Team board.
  await shortcut('2')
  const board = await json(marksBy('.lc-rostercard:not(.lc-rostercard--new)', '.lc-rostercard__name', '.lc-rostercard__model .lc-runtimemark'))
  await drive.capture('the Team board', () => JSON.stringify(board))
  check('every Team card wears its route’s mark', everyoneWearsTheirs(board) && board.filter(([name]) => SEEDED[name] !== undefined).length === 6, JSON.stringify(board))

  // 3. Wren open: the sidebar rows, and the composer's chip.
  say(String(await drive.evaluate(openTeammateScript('Wren'))))
  await sleep(1000)
  const open = await json(`{
    // The sidebar names nobody's route in words: its faces wear the marks.
    faces: [...document.querySelectorAll('.lc-faces__one')].map((face) => [
      (face.getAttribute('aria-label') ?? '').split(' ')[0],
      face.querySelector('.lc-bot__mark')?.getAttribute('data-runtime') ?? null
    ]),
    chip: (() => {
      const chip = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
      const svg = chip?.querySelector('.lc-runtimemark')
      return { runtime: svg?.getAttribute('data-runtime') ?? null, muted: svg?.classList.contains('is-muted') ?? null, dot: chip?.querySelector('.lc-dot') !== null && chip?.querySelector('.lc-dot') !== undefined, text: chip?.innerText.split(/\\s+/).join(' ').trim() ?? '' }
    })()
  }`)
  await drive.capture('Wren open: the sidebar and the composer', () => JSON.stringify(open))
  // Six or more teammates draw four faces and a "+N" (Sidebar), so: every
  // face DRAWN wears its route's mark.
  check('each face in the sidebar wears its route’s mark', open.faces.length >= 4 && everyoneWearsTheirs(open.faces) && open.faces.every(([, runtime]) => runtime !== null), JSON.stringify(open.faces))
  check('the composer’s chip wears Claude’s mark, and no dot', open.chip.runtime === 'claude' && open.chip.dot === false, JSON.stringify(open.chip))

  // 4. The model picker.
  const picker = await json(`(() => {
    const chip = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    chip?.click()
    return null
  })()`)
  void picker
  await sleep(900)
  const groups = await json(`[...document.querySelectorAll('.lc-picker__group')].map((group) => [group.textContent.trim(), group.querySelector('.lc-runtimemark')?.getAttribute('data-runtime') ?? null])`)
  await drive.capture('the model picker', () => JSON.stringify(groups))
  check('each runtime’s group in the picker wears its mark', groups.filter(([title]) => title !== 'Recent').length > 0 && groups.filter(([title]) => title !== 'Recent' && !/your models/i.test(title)).every(([, runtime]) => runtime !== null), JSON.stringify(groups))
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(500)

  // 5. Sable, in Approve each, asked for a command: the card, and the header.
  say(String(await drive.evaluate(openTeammateScript('Sable'))))
  const mode = String(await drive.evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
    if (!control) return 'no mode control'
    control.click(); await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => b.innerText.trim().startsWith('Approve each'))
    if (!item || item.disabled) { control.click(); return 'not offered' }
    item.click(); await new Promise((r) => setTimeout(r, 400))
    return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
  })()`))
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Run exactly this shell command with your bash tool: echo MARK > mark.txt')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'could not send'
  })()`))
  say(`Sable: ${mode}; ${sent}`)
  let card = { runtime: null, header: null }
  for (let i = 0; i < 180 && card.runtime === null; i += 1) {
    card = await json(`{
      runtime: document.querySelector('.lc-card.is-amber .lc-runtimemark')?.getAttribute('data-runtime') ?? null,
      header: document.querySelector('.lc-workroom__role .lc-runtimemark')?.getAttribute('data-runtime') ?? null
    }`)
    if (card.runtime === null) await sleep(1000)
  }
  await drive.capture('Sable asks: the approval card and the header', () => JSON.stringify(card))
  check('the approval card names OpenCode with its mark', card.runtime === 'opencode', JSON.stringify(card))
  check('the conversation’s header wears the runtime’s mark', card.header === 'opencode', JSON.stringify(card))
  say(failures === 0 ? '\nRUNTIME MARKS PASSED' : `\nRUNTIME MARKS: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Six teammates on six runtimes (Claude, Codex, Copilot, Cursor, OpenCode's ${MODEL}, Antigravity's Flash); each surface that names a runtime, photographed. Only Sable ran, on the free model.` })
}
