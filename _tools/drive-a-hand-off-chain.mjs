// A hand-off chain: a routine whose steps go to different teammates, the last
// one checking (0.435).
//
//   node _tools/drive-a-hand-off-chain.mjs [--packaged <exe>] [--tag <name>]
//
// Spends: one short Codex turn (Sable, the checker, on gpt-6-luna, low); Wren
// and Atlas are on the free OpenCode model. Run with LOCUST_SPEND=1.
//
// From OpenRig's conveyor, which Colin asked to be read for "anything worth
// yoinking" (2026-09-27). The folder has a bug report and the buggy file. An
// ordinary three-step routine of Wren's is opened in the editor as a person
// would: step 2 is handed to Atlas, step 3 to Sable as the checker. The card
// must then name the chain; Run must give step 1 to Wren, step 2 to Atlas with
// Wren's answer, and step 3 to Sable with Atlas's; and the run counts only if
// Sable approves -- the thread says which.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const FREE = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('a-hand-off-chain-2026-09-28'), `a-hand-off-chain-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-handoff-ws-')
await writeFile(join(workspace, 'issue.md'), '# Bug: the cart total is wrong\n\nA cart with one 10.00 item shows a total of 20.00. Expected 10.00.\n', 'utf8')
await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    subtotal = sum(item["price"] for item in items)\n    return subtotal + sum(item["price"] for item in items)\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)

const ROUTINE = {
  routineId: 'rt_handoffdrive',
  name: 'Bug to reviewed plan',
  teammateId: 'tm_wren',
  route: { runtime: 'opencode', model: FREE, mode: 'ask' },
  steps: [
    'Read issue.md and cart.py. In two sentences, say what is wrong and where.',
    'Write a three-line plan to fix it. Do not change any files.',
    'Check that the plan fixes the problem the issue describes.'
  ],
  learnedFrom: [],
  createdAt: '2026-09-28T01:00:00.000Z',
  runs: 0
}
const drive = await startDrive({
  name: `hand-off-chain-${tag}`, port: 9771, workspace, outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: FREE, mode: 'ask' } },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:01.000Z', route: { runtime: 'opencode', model: FREE, mode: 'ask' } },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Docs & QA', createdAt: '2026-09-28T01:00:02.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', effort: 'low', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: { 'routines.json': { schemaVersion: 1, routines: [ROUTINE] } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const openRoutines = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return (document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
})()`
const pick = (select, value) => `(() => {
  const el = ${select}
  if (!el) return 'no select'
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return el.value
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const before = String(await drive.evaluate(openRoutines))
  say(`  card before: ${before}`)

  const edited = JSON.parse(String(await drive.capture('The editor: step 2 to Atlas, step 3 to Sable as the checker', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Edit Bug to reviewed plan"]')?.click()
    await new Promise((r) => setTimeout(r, 900))
    const box = document.querySelector('.lc-dialog[aria-label="Edit routine"]')
    if (!box) return JSON.stringify({ open: false })
    const pickers = [...box.querySelectorAll('select[aria-label^="Who takes step"]')]
    const options = pickers[0] ? [...pickers[0].options].map((o) => o.innerText) : []
    ${pick(`box.querySelector('select[aria-label="Who takes step 2"]')`, 'tm_atlas')}
    await new Promise((r) => setTimeout(r, 200))
    ${pick(`document.querySelector('.lc-dialog select[aria-label="Who takes step 3"]')`, 'tm_sable')}
    await new Promise((r) => setTimeout(r, 200))
    const checks = [...document.querySelectorAll('.lc-dialog .lc-routinestep__check input')]
    checks[2]?.click()
    await new Promise((r) => setTimeout(r, 300))
    return JSON.stringify({ open: true, pickers: pickers.length, options, step2: document.querySelector('.lc-dialog select[aria-label="Who takes step 2"]')?.value, step3: document.querySelector('.lc-dialog select[aria-label="Who takes step 3"]')?.value, checked: checks.map((c) => c.checked) })
  })()`))))
  say(`  editor: ${JSON.stringify(edited)}`)
  check('the editor asks who takes each step, and whether it checks', edited.open && edited.pickers === 3 && edited.step2 === 'tm_atlas' && edited.step3 === 'tm_sable' && edited.checked?.[2] === true, JSON.stringify(edited))

  const card = String(await drive.capture('Saved: the card names the chain', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return (document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })()`)))
  say(`  card after: ${card}`)
  check('the card names the chain in step order, the checker marked', /Wren → Atlas → Sable \(checks\)/.test(card), card)

  await drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-routinerow:not(.lc-routineadd)')
    ;[...row.querySelectorAll('button')].find((b) => /run/i.test(b.innerText || b.getAttribute('aria-label') || ''))?.click()
  })()`)
  // Three steps, each a run; follow the sidebar until nothing says it is running, up to 12 minutes.
  let quiet = 0
  for (let waited = 0; waited < 720_000 && quiet < 3; waited += 5000) {
    await sleep(5000)
    const running = await drive.evaluate(`document.querySelectorAll('.lc-spark').length + (document.querySelector('button[aria-label^="Stop the running"]') ? 1 : 0)`)
    quiet = Number(running) === 0 ? quiet + 1 : 0
  }
  await sleep(2000)
  const convs = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-convrow .lc-conv')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 6))`)))
  say(`  sidebar: ${JSON.stringify(convs)}`)

  // Each step's conversation, oldest first: who had it, what it was given, what it said.
  const steps = JSON.parse(String(await drive.evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.lc-convrow .lc-conv')].slice(0, 3).reverse()
    const out = []
    for (const row of rows) {
      row.click()
      await new Promise((r) => setTimeout(r, 1200))
      const head = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      out.push({ head: head.slice(0, 80), thread: thread.slice(0, 1500), tail: thread.slice(-400) })
    }
    return JSON.stringify(out)
  })()`)))
  steps.forEach((step, index) => say(`  step ${index + 1}: ${step.head} || ${step.tail.slice(-220)}`))
  await drive.capture("The checker's step", () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-600) ?? ''`))
  check("step 1 was Wren's, step 2 Atlas's, step 3 Sable's", /Wren/.test(steps[0]?.head ?? '') && /Atlas/.test(steps[1]?.head ?? '') && /Sable/.test(steps[2]?.head ?? ''), steps.map((s) => s.head).join(' | '))
  check("Atlas was given Wren's answer", /Wren did the step before this one and answered/.test(steps[1]?.thread ?? ''), (steps[1]?.thread ?? '').slice(0, 200))
  check("Sable was given Atlas's answer and the checker's rule", /Atlas did the step before this one and answered/.test(steps[2]?.thread ?? '') && /VERDICT: APPROVED/.test(steps[2]?.thread ?? ''), (steps[2]?.thread ?? '').slice(0, 200))
  const all = steps.map((s) => s.thread).join(' ')
  const verdict = /finished: 3 steps completed, approved by Sable/.test(all) ? 'approved' : /Sable, the checker, (asked for changes|gave no verdict)/.test(all) ? 'not approved' : 'none said'
  check('the thread says whether the checker approved, and the card agrees', verdict !== 'none said', verdict)
  const after = String(await drive.capture('Routines, after the run', () => drive.evaluate(openRoutines)))
  say(`  card at the end: ${after}`)
  check('the card counts the run only if Sable approved', verdict === 'approved' ? /run 1 time/.test(after) : /waiting for review/.test(after), `${verdict} || ${after}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren and Atlas on OpenCode / ${FREE}, Sable (checker) on Codex / gpt-6-luna low; a three-step routine of Wren's, handed off in the editor.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
