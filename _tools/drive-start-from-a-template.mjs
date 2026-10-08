// 0.615, the PRD's R16: "Ten starter routines shipped as files, 'Start from a
// template'". A new profile's Routines screen lists the starter routines; one
// is added through the import preview (nothing before Add), a second from the
// add row's dialog once the shelf has one, and both RUN on the free OpenCode
// route to a finished answer. `--all` then adds every template and runs each
// once with sample values, the PRD's "each template runs once on the free
// route". `--packaged <exe>` drives a built copy.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, startDrive, scratchRepository, say, sleep } from './drive-lib.mjs'

if (!FREE_ROUTE.model.startsWith('opencode/') || !FREE_ROUTE.model.endsWith('-free')) throw new Error('This drive requires a free OpenCode route.')
const route = { ...FREE_ROUTE, mode: 'ask' }
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const every = process.argv.includes('--all')
const workspace = await scratchRepository('locust-template-ws-')
// What the file-reading templates are pointed at.
await writeFile(join(workspace, 'sales.csv'), 'date,region,amount\n2026-09-01,North,1200\n2026-09-02,South,\n2026-09-02,South,\n2026-09-03,East,-40\n2026-09-04,West,98000\n', 'utf8')
await writeFile(join(workspace, 'plan.md'), '# Launch plan\n\nWe will launch in October because the market is ready.\n\n1. Build it.\n2. Launch it.\n\nSuccess means people like it.\n', 'utf8')
await writeFile(join(workspace, 'count.py'), '# TODO: handle empty files\nimport sys\n\ndef count(path):\n    return len(open(path).read().splitlines())\n\nif __name__ == "__main__":\n    print(count(sys.argv[1]))\n', 'utf8')
// Committed, so a clean status afterwards means nothing was changed.
execFileSync('git', ['add', '.'], { cwd: workspace })
execFileSync('git', ['commit', '-q', '-m', 'the files the templates read'], { cwd: workspace })
const seed = { schemaVersion: 1,
  teammates: [{ teammateId: 'tm_fern', name: 'Fern', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-04T00:00:00Z', route }],
  missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
// Sample values for every template that asks something.
const SAMPLES = {
  'review-a-file': { file: 'count.py' },
  'plan-a-change': { change: 'Make count.py report the number of words as well as lines.' },
  'challenge-an-idea': { idea: 'A command-line tool that counts the lines in every file of a folder and prints the ten longest.' },
  'write-a-status-update': {},
  'weekly-report-from-notes': { notes: 'Mon: fixed the empty-file crash in count.py. Tue: wrote the launch plan. Wed: waiting on the sales numbers from finance. Thu: started the word count.' },
  'summarize-a-long-text': { text: 'The committee met on Tuesday to review the budget. After a long discussion it agreed to move the launch from October to November, so that testing can finish. Two questions were left open: who owns the support inbox after launch, and whether the price changes for existing customers. The next meeting is in two weeks.' },
  'draft-a-reply': { message: 'Hi, could we move Friday’s review to Monday morning? Something came up. Thanks, Sam' },
  'check-a-spreadsheet': { file: 'sales.csv' },
  'find-the-gaps-in-a-document': { file: 'plan.md' }
}

let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${String(detail).slice(0, 400)}` : ''}`)
}
const SET = `(selector, value) => {
  const node = document.querySelector(selector)
  if (!node) throw new Error('No input: ' + selector)
  const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}`
const click = `(label) => { const node = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === label); if (!node) throw new Error('No button: ' + label); node.click() }`
const toRoutines = async (drive) => {
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()`)
  await sleep(700)
}
const routinesNow = (drive) => drive.evaluate(`(async () => { const answer = await window.desktop.listRoutines(); return answer.ok ? answer.data.routines : [] })()`)
// The empty screen's layout: no sideways scroll, nothing clipped, the meta on the name's line.
const LAYOUT = `(() => {
  const pane = document.querySelector('.lc-automations .lc-empty')
  const rows = [...document.querySelectorAll('.lc-templates__row')]
  const clipped = rows.filter((row) => { const what = row.querySelector('.lc-templates__what'); return what.scrollWidth > what.clientWidth + 1 }).length
  const offLine = rows.filter((row) => { const name = row.querySelector('.lc-templates__name').getBoundingClientRect(); const meta = row.querySelector('.lc-templates__meta').getBoundingClientRect(); return Math.abs(name.top - meta.top) > 4 || meta.left < name.right }).length
  const names = rows.filter((row) => { const name = row.querySelector('.lc-templates__name'); return name.scrollWidth > name.clientWidth + 1 }).map((row) => row.querySelector('.lc-templates__name').innerText)
  const first = rows[0]?.getBoundingClientRect()
  return { rows: rows.length, sideways: pane ? pane.scrollWidth > pane.clientWidth + 1 : 'no pane', clipped, offLine, truncatedNames: names, firstRowTop: first ? Math.round(first.top) : -1, rowHeight: first ? Math.round(first.height) : -1, width: innerWidth, height: innerHeight }
})()`

// Wait for the ROUTINE's run to finish, not its first step's: a conversation is
// "completed" between steps, and a four-step routine is still running then (the
// first --all pass started the next template at "step 3 of 4", refused). The
// store counts a run and clears its execution in one write when the last step ends.
async function finishedRun(drive, routineId, startedAfter, limit = 600_000) {
  let mission
  for (let waited = 0; waited < limit; waited += 2000) {
    await sleep(2000)
    const routine = (await routinesNow(drive)).find((entry) => entry.routineId === routineId)
    const history = await drive.evaluate('window.desktop.getMissionHistory()')
    const found = history?.ok ? history.data.missions.filter((entry) => entry.startedBy?.routineId === routineId && !startedAfter.has(entry.missionId)) : []
    if (found.length === 0) continue
    const answer = await drive.evaluate(`window.desktop.readMission(${JSON.stringify(found[0].missionId)})`)
    mission = answer?.ok ? answer.data.mission : found[0]
    const counted = (routine?.runs ?? 0) >= 1 && routine?.execution === undefined
    const stopped = ['failed', 'cancelled'].includes(mission.phase) && routine?.execution?.status !== 'running'
    if (counted || stopped) return mission
  }
  return mission
}
// The answer as the ledger keeps it: message deltas, replaced or appended per item.
const answerOf = (mission) => {
  const items = new Map()
  for (const event of mission?.events ?? []) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text } = event.payload ?? {}
    items.set(itemId, operation === 'append' ? (items.get(itemId) ?? '') + String(text ?? '') : String(text ?? ''))
  }
  return [...items.values()].join('\n\n')
}
// Every conversation one routine's run made, oldest first: each step is its own,
// on the same runtime thread, so a later step reads what an earlier one answered.
async function runMissions(drive, routineId) {
  const history = await drive.evaluate('window.desktop.getMissionHistory()')
  const found = history?.ok ? history.data.missions.filter((entry) => entry.startedBy?.routineId === routineId) : []
  const read = []
  for (const entry of found) {
    const answer = await drive.evaluate(`window.desktop.readMission(${JSON.stringify(entry.missionId)})`)
    read.push(answer?.ok ? answer.data.mission : entry)
  }
  return read.sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt)))
}
// "Each run once on the free OpenCode route with the transcript kept" (the PRD's week 3).
async function keepTranscript(drive, id, missions) {
  const folder = join(drive.out, 'transcripts')
  await mkdir(folder, { recursive: true })
  const steps = missions.flatMap((mission, at) => [`## Step ${String(at + 1)} of ${String(missions.length)}: ${String(mission.phase)}`, '', `- mission: ${String(mission.missionId)}`, `- route: ${String(mission.runtime)} / ${String(mission.model)}`, '', '### Prompt', '', String(mission.prompt ?? ''), '', '### Answer', '', answerOf(mission), ''])
  await writeFile(join(folder, `${id}.md`), [`# ${id}`, '', ...steps].join('\n'), 'utf8')
}

let drive
try {
  drive = await startDrive({ ...(packaged === undefined ? {} : { packaged }), name: every ? 'start-from-a-template-all' : 'start-from-a-template', port: 9898, workspace, seed, keep: true })
  await drive.ready()
  // How many templates Locust offers, from its own list: 11 when this drive was written (0.615), 14 since the
  // three teammate chains (0.643). Sweep 9 failed five checks on the hardcoded eleven.
  const offered = await drive.evaluate('window.desktop.listRoutineTemplates()')
  const COUNT = offered?.ok ? offered.data.templates.length : -1
  check('Locust lists its templates', COUNT >= 11, String(COUNT))
  await drive.send('Page.bringToFront')
  await drive.resize(1200, 720)
  await toRoutines(drive)

  // 1. The empty screen lists them, at three sizes.
  for (const [width, height] of [[1000, 680], [1200, 720], [1600, 1000]]) {
    await drive.resize(width, height)
    await sleep(500)
    const layout = await drive.capture(`empty Routines at ${String(width)}x${String(height)}`, () => drive.evaluate(LAYOUT))
    check(`${String(width)}x${String(height)}: every template, no sideways scroll, nothing clipped, meta on the name's line`,
      layout.rows === COUNT && layout.sideways === false && layout.clipped === 0 && layout.offLine === 0, JSON.stringify(layout))
  }
  await drive.resize(1200, 720)
  const words = await drive.evaluate(`document.querySelector('.lc-automations')?.innerText ?? ''`)
  check('the empty screen offers the templates in place of the old sentence', words.includes('Start from a template, or press New routine to write your own.') && !words.includes('Press New routine to write one'), words.slice(0, 300))

  // 2. One added from the empty list: a preview first, nothing before Add.
  await drive.evaluate(`[...document.querySelectorAll('.lc-templates__row')].find((b) => b.querySelector('.lc-templates__name').innerText === 'Explain this project')?.click()`)
  await sleep(700)
  const preview = await drive.capture('Explain this project, previewed', () => drive.evaluate(`document.querySelector('[role=dialog][aria-label="Add a starter routine"]')?.innerText ?? 'no dialog'`))
  // Case-blind: the field labels are drawn in capitals, and innerText reads them so.
  check('the preview names its steps and a teammate choice, as added rather than imported', ['Explain this project', 'Steps', 'Give it to', 'Add routine', 'runs nothing until you press Run'].every((text) => preview.toLowerCase().includes(text.toLowerCase())) && !/import|connectors it needs/i.test(preview), preview.slice(0, 300))
  check('a preview adds nothing', (await routinesNow(drive)).length === 0)
  await drive.evaluate(`(${SET})('[aria-label="Give routine to"]', 'tm_fern')`)
  await sleep(150)
  await drive.evaluate(`(${click})('Add routine')`)
  await sleep(900)
  const first = await drive.capture('Explain this project added', () => routinesNow(drive))
  check('it is added once, to Fern, Ask, no schedule, never run', first.length === 1 && first[0].teammateId === 'tm_fern' && first[0].route.mode === 'ask' && first[0].schedule === undefined && first[0].runs === 0, JSON.stringify(first.map((entry) => ({ name: entry.name, mode: entry.route.mode, runs: entry.runs }))))
  const notice = await drive.evaluate(`document.querySelector('.lc-automations .lc-claim')?.innerText ?? ''`)
  check('the notice says what was added', notice.includes('Added Explain this project. It has no schedule and has not run.'), notice)

  // 3. A second from the add row, once the shelf has one.
  const addRow = await drive.evaluate(`[...document.querySelectorAll('.lc-routineadd')].map((b) => b.innerText).join(' | ')`)
  check('the shelf ends with Start from a template, naming the first few', addRow.includes('Start from a template') && addRow.includes(`Explain this project, Find what is unfinished, Review a file and ${String(COUNT - 3)} more`), addRow)
  await drive.evaluate(`[...document.querySelectorAll('.lc-routineadd')].find((b) => b.innerText.includes('Start from a template'))?.click()`)
  await sleep(600)
  const picker = await drive.capture('the template picker', () => drive.evaluate(`({ open: !!document.querySelector('[role=dialog][aria-label="Start from a template"]'), rows: document.querySelectorAll('[role=dialog] .lc-templates__row').length, body: (() => { const b = document.querySelector('[role=dialog] .lc-dialog__body'); return b ? { scroll: b.scrollHeight, client: b.clientHeight } : null })() })`))
  check('the picker lists every template and scrolls inside itself', picker.open && picker.rows === COUNT && picker.body !== null, JSON.stringify(picker))
  await drive.evaluate(`[...document.querySelectorAll('[role=dialog] .lc-templates__row')].find((b) => b.querySelector('.lc-templates__name').innerText === 'Summarize a long text')?.click()`)
  await sleep(700)
  const second = await drive.evaluate(`document.querySelector('[role=dialog][aria-label="Add a starter routine"]')?.innerText ?? 'no dialog'`)
  check('choosing one closes the picker and opens its preview', second.includes('Summarize a long text') && second.includes('The text to summarize') && !(await drive.evaluate(`!!document.querySelector('[role=dialog][aria-label="Start from a template"]')`)), second.slice(0, 200))
  await drive.evaluate(`(${SET})('[aria-label="Give routine to"]', 'tm_fern')`)
  await sleep(150)
  await drive.evaluate(`(${click})('Add routine')`)
  await sleep(900)
  const two = await drive.capture('two starter routines on the shelf', () => routinesNow(drive))
  check('the second is added beside the first', two.length === 2 && two.some((entry) => entry.name === 'Summarize a long text'), two.map((entry) => entry.name).join(', '))

  // 4. Both run on the free route to a finished answer.
  const seen = new Set()
  const explain = two.find((entry) => entry.name === 'Explain this project')
  await drive.evaluate(`[...document.querySelectorAll('.lc-routinerow')].find((row) => row.innerText.includes('Explain this project'))?.querySelector('button.lc-ghostbutton:not(.lc-iconbutton)')?.click()`)
  const ran = await finishedRun(drive, explain.routineId, seen)
  seen.add(ran?.missionId)
  await keepTranscript(drive, 'explain-this-project', await runMissions(drive, explain.routineId))
  await drive.capture('Explain this project ran', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.slice(-1500)`))
  check('Explain this project runs on the free route to completion', ran?.phase === 'completed' && ran.runtime === 'opencode' && ran.model === route.model, JSON.stringify({ phase: ran?.phase, runtime: ran?.runtime, model: ran?.model }))
  await toRoutines(drive)
  const summarize = two.find((entry) => entry.name === 'Summarize a long text')
  await drive.evaluate(`[...document.querySelectorAll('.lc-routinerow')].find((row) => row.innerText.includes('Summarize a long text'))?.querySelector('button.lc-ghostbutton:not(.lc-iconbutton)')?.click()`)
  await sleep(500)
  const asks = await drive.capture('Summarize a long text asks for its text', () => drive.evaluate(`document.querySelector('[role=dialog][aria-label="Run routine"]')?.innerText ?? 'no dialog'`))
  check('Run asks for the text to summarize', asks.includes('The text to summarize'), asks.slice(0, 200))
  await drive.evaluate(`(${SET})('[aria-label="Value for The text to summarize"]', ${JSON.stringify(SAMPLES['summarize-a-long-text'].text)})`)
  await sleep(150)
  await drive.evaluate(`(${click})('Run routine')`)
  const summarized = await finishedRun(drive, summarize.routineId, seen)
  seen.add(summarized?.missionId)
  await keepTranscript(drive, 'summarize-a-long-text', await runMissions(drive, summarize.routineId))
  await drive.capture('Summarize a long text ran', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.slice(-1500)`))
  check('Summarize a long text runs to completion with the text it was given', summarized?.phase === 'completed' && String(summarized.prompt ?? '').includes('November'), JSON.stringify({ phase: summarized?.phase }))

  // 5. --all: every template, added through the same bridge and run once.
  if (every) {
    const listed = await drive.evaluate('window.desktop.listRoutineTemplates()')
    const ids = listed.ok ? listed.data.templates.map((entry) => entry.id) : []
    check('the bridge lists every template', ids.length === COUNT, ids.join(', '))
    for (const id of ids.filter((entry) => entry !== 'explain-this-project' && entry !== 'summarize-a-long-text')) {
      const preview = await drive.evaluate(`window.desktop.previewRoutineTemplate(${JSON.stringify(id)})`)
      if (!preview?.ok || preview.data.preview === undefined) { check(`${id}: previews`, false, JSON.stringify(preview)); continue }
      const added = await drive.evaluate(`window.desktop.importRoutine(${JSON.stringify({ token: preview.data.preview.token, teammateId: 'tm_fern', route })})`)
      if (!added?.ok) { check(`${id}: is added`, false, JSON.stringify(added)); continue }
      const routine = added.data.routine
      const values = SAMPLES[id]
      const started = await drive.evaluate(`window.desktop.runRoutine(${JSON.stringify(routine.routineId)}${values === undefined ? '' : `, ${JSON.stringify(values)}`})`)
      if (!started?.ok) { check(`${id}: starts`, false, JSON.stringify(started)); continue }
      await finishedRun(drive, routine.routineId, seen)
      const missions = await runMissions(drive, routine.routineId)
      await keepTranscript(drive, id, missions)
      // Every step ran, each to an answer of its own.
      const answered = missions.filter((mission) => mission.phase === 'completed' && answerOf(mission).trim().length > 80).length
      const last = answerOf(missions.at(-1))
      check(`${id}: every step runs once on the free route to an answer`, missions.length === routine.steps.length && answered === routine.steps.length, `${String(answered)}/${String(routine.steps.length)} steps answered · ${last.replace(/\s+/g, ' ').slice(0, 160)}`)
      // The routine writes nothing: Ask mode, and every template is written to read.
    }
    // Every template is written to read, and each ran in Ask: the folder is as it was.
    const touched = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).filter((line) => !/^\?\? \.locust/.test(line))
    check('no template changed or made a file in the folder', touched.length === 0, touched.join(' | '))
    await drive.capture('every template ran', () => routinesNow(drive).then((all) => all.map((entry) => `${entry.name}: ${String(entry.runs)} run`).join(' | ')))
  }

  check('no renderer errors in any capture', drive.record.every((entry) => entry.errors.length === 0), drive.record.filter((entry) => entry.errors.length > 0).map((entry) => entry.title).join(', '))
  await drive.finish({ intro: `0.615 starter routines; ${packaged === undefined ? 'dev build' : 'packaged'}; ${route.model}${every ? '; every template run once' : ''}.`, extra: `${String(checks - failures)}/${String(checks)} checks passed.` })
  drive = undefined
} finally {
  if (drive !== undefined) await drive.finish({ intro: 'stopped early', extra: `${String(checks - failures)}/${String(checks)} checks passed before it stopped.` }).catch(() => undefined)
  say(`${String(checks - failures)}/${String(checks)} checks passed`)
  process.exitCode = failures === 0 && checks > 0 ? 0 : 1
}
