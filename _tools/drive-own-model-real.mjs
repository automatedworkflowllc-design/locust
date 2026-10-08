// Your own model, end to end against a REAL OpenAI-compatible server (0.640).
//
//   LOCUST_SPEND=1 node _tools/drive-own-model-real.mjs [--base-url http://127.0.0.1:8089/v1] [--model qwen2.5-3b-instruct]
//        [--packaged <Locust.exe>] [--tag <name>] [--only a,b,c,d,e]
//
// drive-own-model.mjs (0.357) proves the path against a stand-in endpoint that
// answers "Hello from Acme.". A company with its own open-weight model plugs a
// real server in -- Ollama, llama.cpp's llama-server, vLLM, LM Studio -- and
// what Locust says of it must hold when they try. This drives the screens a
// person uses, against whatever real server --base-url names:
//
//   (a) Settings > Your own models: Test answers, and says whether
//       the model can use tools;
//   (b) Add model; it is under "Your models" in a teammate's model picker;
//   (c) a run in Edit on it really writes a file in the folder;
//   (d) a run in Approve each on it raises a card (left unanswered; the run is
//       stopped, and nothing is written);
//   (e) Home, the chat mode chip on Blind, it against a free OpenCode model;
//       Keep this one on Model A; the names show.
//
// LOCUST_SPEND=1 only because a drive window refuses any route that is not a
// free model; the model is the server's own, nothing is spent. Start the
// server first: the drive checks it lists the model before launching Locust.
// One page script may take at most 400 s (drive-lib's send), so a run is sent
// in one and watched from here, LOCUST_DRIVE_RUN_MINUTES at most (15).
//
// --shots <folder>: pictures for a post, 1200x780 at twice the pixels
// (2400x1560), in a project called acme-storefront, the model under --name.
// The frames worth showing are copied to the folder as they are taken.

import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const BASE = arg('--base-url') ?? 'http://127.0.0.1:8089/v1'
const MODEL = arg('--model') ?? 'qwen2.5-3b-instruct'
const NAME = arg('--name') ?? 'Our Model'
const NAME_PATTERN = NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SHOTS = arg('--shots')
const only = new Set((arg('--only') ?? 'a,b,c,d,e').split(','))
const MINUTES = Number(process.env.LOCUST_DRIVE_RUN_MINUTES ?? '15')
const FREE_MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/muse-spark-1.3-contributor-free'

// A hosted provider's key (Anthropic's OpenAI-compatible endpoint, 10/07): read once from this process's memory,
// typed into the Key field as a person would, never printed, and taken out of the environment before Locust starts.
const KEY = process.env.LOCUST_OWN_MODEL_KEY || undefined
delete process.env.LOCUST_OWN_MODEL_KEY
const authHeaders = KEY === undefined ? {} : { Authorization: `Bearer ${KEY}`, 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }

// The server first: a drive against nothing proves nothing.
const listed = await fetch(`${BASE}/models`, { headers: authHeaders }).then((response) => response.json()).catch(() => undefined)
const ids = Array.isArray(listed?.data) ? listed.data.map((entry) => entry.id) : []
if (!ids.includes(MODEL)) {
  say(`the server at ${BASE} does not list ${MODEL} (it lists: ${ids.join(', ') || 'nothing'}); start it first`)
  process.exit(1)
}
say(`server: ${BASE} lists ${ids.join(', ')}`)

/** For pictures: a project with a plain name, made afresh each time. */
async function namedProject(folder) {
  await rm(folder, { recursive: true, force: true })
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'README.md'), '# Acme Storefront\n\nThe website for a small online shop: product pages, a cart and a checkout.\n', 'utf8')
  await writeFile(join(folder, 'LOCUST.md'), 'Keep pages simple and fast: plain HTML and CSS.\n', 'utf8')
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'drive@locust.test'], ['config', 'user.name', 'Locust drive'], ['add', '.'], ['commit', '-q', '-m', 'first']]) execFileSync('git', args, { cwd: folder })
  return folder
}
if (SHOTS !== undefined) await mkdir(SHOTS, { recursive: true })
const workspace = SHOTS === undefined ? await scratchRepository('locust-drive-own-real-ws-') : await namedProject(join(SHOTS, 'work', 'acme-storefront'))
// What the Edit run is asked to write, and what counts as written.
const EDIT = SHOTS === undefined
  ? { file: 'hello.txt', ask: 'Create a file named hello.txt in this folder that contains exactly the word hello. Use your file-writing tool. Then say in one sentence what you did.', ok: (text) => /hello/i.test(text) }
  : { file: 'TODO.md', ask: "Create a file named TODO.md in this folder listing three next steps for this shop's website, one per line. Use your file-writing tool. Then say in one sentence what you did.", ok: (text) => text.trim().length > 0 }
const drive = await startDrive({
  name: `own-model-real-${tag}`,
  port: 9617,
  workspace,
  spends: true,
  outPath: join(recordRoot('own-model-real-2026-10-05'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date(Date.now() - 86_400_000).toISOString(), route: { runtime: 'opencode', model: FREE_MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const results = []
const check = (letter, what, ok, detail) => {
  results.push(`${letter} ${ok ? 'PASS' : 'FAIL'}`)
  say(`  [${ok ? 'PASS' : 'FAIL'}] (${letter}) ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 900)}`}`)
}

const type = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)})
  if (!input) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`
const inputs = (index) => `.lc-ownmodel__form label:nth-of-type(${String(index)}) input`
// The words on the way there, for anyone writing the steps down.
const settingsRuntimes = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  // Its own page in Settings (settingsPages.ts); it was a section of AI agents.
  const nav = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Your own models')
  nav?.click()
  for (let i = 0; i < 20 && !document.querySelector('.lc-ownmodel__form'); i += 1) await new Promise((r) => setTimeout(r, 150))
  const form = document.querySelector('.lc-ownmodel__form')
  if (!form) return 'no Your own models form'
  form.closest('section')?.scrollIntoView({ block: 'start' })
  return JSON.stringify({
    nav: nav ? 'Your own models' : 'no Your own models button',
    heading: form.closest('section')?.querySelector('h2, h3')?.textContent.trim() ?? '',
    labels: [...form.querySelectorAll('label')].map((label) => label.innerText.replace(/\\s+/g, ' ').trim()),
    buttons: [...form.querySelectorAll('button')].map((b) => b.textContent.trim())
  })
})()`
const pressIn = (scope, label, waitSeconds) => `(async () => {
  const button = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!button) return 'no ' + ${JSON.stringify(label)} + ' button'
  if (button.disabled) return ${JSON.stringify(label)} + ' is disabled'
  button.click()
  for (let i = 0; i < ${String(waitSeconds * 4)}; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const said = document.querySelector('.lc-ownmodel__form .lc-ownmodel__said')?.textContent
    if (said && !said.startsWith('Testing')) return said
  }
  return 'nothing said'
})()`
const openWren = `(async () => {
  const face = ${teammateFace('Wren')}
  face?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
})()`
// The chat box's mode, chosen as a person would.
const MODE = (pattern) => `(async () => {
  const control = document.querySelector('button[aria-label="Permission mode"]') ?? [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const items = [...document.querySelectorAll('[role=menuitemradio]')]
  const item = items.find((b) => ${pattern}.test(b.innerText.trim()))
  if (!item || item.disabled) { control.click(); return 'not offered; the menu: ' + items.map((b) => b.innerText.split(/\\s+/).join(' ').trim()).join(' / ') }
  item.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`
const CARD = `document.querySelector('[role=group][aria-label="Approval required"]')`
const SEND = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no chat box'
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const send = document.querySelector('button[aria-label="Send"]')
    if (send && !send.disabled) { send.click(); return 'sent' }
  }
  return 'no send'
})()`
const STATE = `JSON.stringify({
  running: Boolean(document.querySelector('button[aria-label^="Stop the running"]')),
  card: ((${CARD})?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 400),
  thread: (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(-700)
})`
/** A run, watched from here: until a card shows, it ends, or the bound passes. */
const watchRun = async (minutes) => {
  let started = false
  let state = { running: false, card: '', thread: '' }
  const began = Date.now()
  for (let waited = 0; waited < minutes * 60_000; waited += 3000) {
    await sleep(3000)
    state = JSON.parse(String(await drive.evaluate(STATE)))
    if (state.running) started = true
    const seconds = Math.round((Date.now() - began) / 1000)
    if (state.card !== '') return { ended: 'card', seconds, ...state }
    if (started && !state.running) return { ended: 'ended', seconds, ...state }
    if (!started && waited > 30_000) return { ended: 'never seen running', seconds, ...state }
  }
  return { ended: 'still running', seconds: Math.round((Date.now() - began) / 1000), ...state }
}
const STOP = `(async () => {
  document.querySelector('button[aria-label^="Stop the running"]')?.click()
  await new Promise((r) => setTimeout(r, 2500))
  return (document.querySelector('button[aria-label^="Stop the running"]') ? 'still running' : 'stopped') + '; card ' + ((${CARD}) ? 'still shown' : 'gone')
})()`
const COMPARE = `JSON.stringify({
  open: document.querySelector('.lc-compare') !== null,
  states: [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim()),
  names: [...document.querySelectorAll('.lc-compare__head .lc-compare__name')].map((el) => el.textContent.trim()),
  shell: [...document.querySelectorAll('.lc-compare__bar, .lc-compare__head, .lc-compare__foot')].map((el) => el.innerText).join(' | ').replace(/\\s+/g, ' ').slice(0, 500),
  answers: [...document.querySelectorAll('.lc-compare__cellbody')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 240))
})`

/** A step whose frame is also a picture: copied to --shots as <file>.png. */
const shoot = async (file, title, action) => {
  const said = await drive.capture(title, action)
  if (SHOTS !== undefined) {
    const last = (await readdir(drive.out)).filter((name) => name.endsWith('.png')).sort().at(-1)
    if (last !== undefined) await copyFile(join(drive.out, last), join(SHOTS, `${file}.png`))
  }
  return said
}
// The picker open on the chat box, from the top: your models first, then each AI tool's.
// It opens at the chosen row, so this is taken once the model is chosen (it was the free one).
const OPEN_PICKER = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  control.click()
  await new Promise((r) => setTimeout(r, 900))
  let list = document.querySelector('.lc-picker__row')
  while (list && list.scrollHeight <= list.clientHeight) list = list.parentElement
  list?.scrollTo(0, 0)
  await new Promise((r) => setTimeout(r, 300))
  return [...document.querySelectorAll('.lc-picker__group')].map((g) => g.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 8).join(' | ')
})()`
const CLOSE_PICKER = `(async () => {
  ;[...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.click()
  await new Promise((r) => setTimeout(r, 400))
  return document.querySelector('.lc-picker__input') ? 'still open' : 'closed'
})()`
// Test again on the kept row, and what it says there.
const TEST_KEPT = `(async () => {
  const row = [...document.querySelectorAll('.lc-ownmodel')].find((one) => one.innerText.includes(${JSON.stringify(NAME)}))
  const button = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Test')
  if (!button) return 'no Test on the row'
  button.click()
  for (let i = 0; i < 360; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const said = row.querySelector('.lc-ownmodel__said')?.textContent
    if (said && !said.startsWith('Testing')) return said
  }
  return 'nothing said'
})()`
const TO_THE_END = `(() => {
  let box = document.querySelector('.lc-thread')
  while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement
  box?.scrollTo(0, box.scrollHeight)
  return 1
})()`

try {
  await drive.capture('launch: Wren on a free model; nothing of your own yet', () => drive.ready())
  if (SHOTS === undefined) await drive.resize(1440, 900)
  else await drive.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 2, mobile: false })

  // (a) and (b): the form a person fills in.
  const form = String(await drive.capture('Settings > Your own models', () => drive.evaluate(settingsRuntimes)))
  say(`  the form: ${form}`)
  await drive.evaluate(type(inputs(1), NAME))
  await drive.evaluate(type(inputs(2), MODEL))
  await drive.evaluate(type(inputs(3), BASE))
  if (KEY !== undefined && !(await drive.evaluate(type(inputs(4), KEY)))) say('  the Key field was not found')
  const began = Date.now()
  const tested = String(await drive.capture('(a) Test, against the real server', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Test', 90))))
  const testSeconds = Math.round((Date.now() - began) / 1000)
  const switchSays = String(await drive.evaluate(`document.querySelector('.lc-ownmodel__tools .lc-ownmodel__name')?.textContent ?? 'no switch'`))
  if (only.has('a')) check('a', 'Test: it answered, it serves the model, and whether it can use tools', tested.includes(`It answered, and serves ${MODEL}.`) && /It can use tools\.|set to chat only\./.test(tested), `"${tested}" in ${String(testSeconds)} s || the tools switch: ${switchSays}`)
  const added = String(await drive.capture('(b) Add model', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Add model', 30))))
  const row = String(await drive.evaluate(`[...document.querySelectorAll('.lc-ownmodel')].map((one) => one.innerText.replace(/\\s+/g, ' ').trim()).find((text) => text.includes(${JSON.stringify(NAME)})) ?? 'no row'`))
  // Test once more on the kept row: the key it keeps, the switch it sets.
  const keptTested = String(await shoot('1-settings-your-own-models', 'Test again, on the added model', () => drive.evaluate(TEST_KEPT)))
  if (only.has('a')) check('a', 'Test on the added model says the same', keptTested.includes(`It answered, and serves ${MODEL}.`) && /It can use tools\.|set to chat only\./.test(keptTested), keptTested)
  await drive.capture('open Wren', () => drive.evaluate(openWren))
  const picked = String(await drive.capture(`(b) the picker: ${NAME} under Your models`, () => drive.evaluate(pickRouteScript({ group: '/Your models/i', search: NAME.split(/\s+/)[0], row: `/${NAME_PATTERN}/` }))))
  say(`  the picker's groups: ${String(await shoot('2-picker-your-models', 'The picker again: your model above the rest', () => drive.evaluate(OPEN_PICKER)))}; ${String(await drive.evaluate(CLOSE_PICKER))}`)
  const named = String(await drive.evaluate(`JSON.stringify({
    chip: (document.querySelector('form.command-dock button[aria-haspopup="listbox"]')?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
    header: (document.querySelector('.lc-workroom__role')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })`))
  if (only.has('b')) check('b', 'added; under "Your models" in the picker; picked, and named as yours', added.includes(`${NAME} is in every teammate's model list`) && picked.includes(NAME) && JSON.parse(named).chip.startsWith(NAME), `${added} || row: ${row} || picked: ${picked} || ${named}`)

  // (c) Edit: a file really written, in the folder itself.
  if (only.has('c')) {
    const mode = String(await drive.evaluate(MODE('/^Edit\\b/')))
    const sent = String(await drive.capture(`(c) Edit: asked to write ${EDIT.file}`, () => drive.evaluate(SEND(EDIT.ask))))
    const run = await watchRun(MINUTES)
    await drive.evaluate(TO_THE_END)
    await sleep(800)
    await shoot('3-edit-run-receipt', `(c) the run: ${run.ended}`, () => drive.evaluate('1'))
    const written = await readFile(join(workspace, EDIT.file), 'utf8').catch(() => undefined)
    const elsewhere = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspace, encoding: 'utf8' }).trim()
    check('c', `a run in Edit on it writes ${EDIT.file} in the folder itself`, written !== undefined && EDIT.ok(written), `${mode} || ${sent} || ${EDIT.file}: ${written === undefined ? 'absent' : JSON.stringify(written.slice(0, 160))} || the folder's changes: ${elsewhere.replace(/\s+/g, ' ')} || ${run.ended} after ${String(run.seconds)} s || card: ${run.card || 'none'} || thread: ${run.thread.slice(-400)}`)
  }

  // (d) Approve each: a card. Nothing here answers it; the run is stopped.
  if (only.has('d')) {
    const mode = String(await drive.evaluate(MODE('/^Approve each/')))
    const sent = String(await drive.evaluate(SEND('Create a file named second.txt in this folder that contains the word two. Use your file-writing tool.')))
    const run = await watchRun(MINUTES)
    await drive.capture(run.ended === 'card' ? '(d) Approve each: the card' : `(d) Approve each: ${run.ended}`, () => drive.evaluate('1'))
    const stopped = run.ended === 'card' || run.ended === 'still running' ? String(await drive.capture('(d) stopped; the card left unanswered', () => drive.evaluate(STOP))) : 'not running'
    const second = await readFile(join(workspace, 'second.txt'), 'utf8').catch(() => undefined)
    check('d', 'a run in Approve each on it raises a card; unanswered, nothing is written', run.ended === 'card' && second === undefined, `${mode} || ${sent} || after ${String(run.seconds)} s: ${run.ended} || card: ${run.card || 'none'} || ${stopped} || second.txt: ${second === undefined ? 'absent' : 'WRITTEN'} || thread: ${run.thread.slice(-300)}`)
  }

  // (e) Blind, set up on Home as a person does: the chat mode chip, Blind, a model in each slot.
  if (only.has('e')) {
    await drive.evaluate(`(async () => { document.querySelector('.lc-brand__lockup')?.click(); await new Promise((r) => setTimeout(r, 1500)); return 1 })()`)
    const setUp = String(await drive.capture('(e) Home: the chat mode chip on Blind', () => drive.evaluate(`(async () => {
      const chip = document.querySelector('.lc-control--chatmode')
      if (!chip) return 'no chat mode chip'
      chip.click()
      await new Promise((r) => setTimeout(r, 400))
      const items = [...document.querySelectorAll('[role="menu"][aria-label="Direct or compare"] [role="menuitemradio"]')]
      const item = items.find((b) => /^Blind/.test(b.innerText.trim()))
      if (!item) return 'no Blind item; the menu: ' + items.map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
      item.click()
      await new Promise((r) => setTimeout(r, 900))
      const done = [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')
      if (done && !done.disabled) done.click()
      await new Promise((r) => setTimeout(r, 500))
      return (chip.getAttribute('aria-label') ?? '') + ' | slots: ' + String(document.querySelectorAll('.lc-slotgroup').length)
    })()`)))
    say(`  (e) set up: ${setUp}`)
    const slots = []
    for (const [index, want] of [{ heading: '^Your models', search: NAME.split(' ')[0], row: NAME_PATTERN }, { heading: '^OpenCode', search: 'muse', row: 'muse.?spark' }].entries()) {
      slots.push(String(await drive.evaluate(`(async () => {
        const chip = document.querySelectorAll('.lc-slotgroup')[${String(index)}]?.querySelector('.lc-control--slot')
        if (!chip) return 'no slot chip'
        chip.click()
        await new Promise((r) => setTimeout(r, 600))
        const box = document.querySelector('.lc-picker__input')
        if (box) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(want.search)})
          box.dispatchEvent(new Event('input', { bubbles: true }))
          await new Promise((r) => setTimeout(r, 700))
        }
        let heading = ''
        const rows = []
        for (const el of document.querySelectorAll('.lc-picker__group, .lc-picker__row')) {
          if (el.classList.contains('lc-picker__group')) { heading = el.textContent.replace(/\\s+/g, ' ').trim(); continue }
          if (el.classList.contains('is-recent')) continue
          rows.push({ el, heading })
        }
        const found = rows.find((one) => !one.el.disabled && new RegExp(${JSON.stringify(want.heading)}, 'i').test(one.heading) && new RegExp(${JSON.stringify(want.row)}, 'i').test(one.el.querySelector('.lc-picker__label')?.textContent ?? ''))
        if (!found) return 'no row; rows: ' + rows.map((one) => one.heading + ' / ' + (one.el.querySelector('.lc-picker__label')?.textContent ?? '')).slice(0, 12).join('; ')
        found.el.click()
        await new Promise((r) => setTimeout(r, 600))
        return found.heading + ' > ' + (found.el.querySelector('.lc-picker__label')?.textContent ?? '') + ' | slot: ' + (document.querySelectorAll('.lc-slotgroup')[${String(index)}]?.innerText.replace(/\\s+/g, ' ').trim() ?? '')
      })()`)))
    }
    say(`  (e) slots: ${JSON.stringify(slots)}`)
    const sent = String(await drive.capture('(e) Blind: sent', () => drive.evaluate(SEND(SHOTS === undefined ? 'In one sentence, what is a locust?' : 'In two sentences: what makes a good product page for a small online shop?'))))
    let shown = JSON.parse(String(await drive.evaluate(COMPARE)))
    const begun = Date.now()
    for (let waited = 0; waited < MINUTES * 60_000; waited += 3000) {
      await sleep(3000)
      shown = JSON.parse(String(await drive.evaluate(COMPARE)))
      if (waited > 15_000 && shown.states.length === 2 && shown.states.every((state) => state !== 'working' && state !== 'waiting')) break
    }
    const ranFor = Math.round((Date.now() - begun) / 1000)
    await shoot('4-blind-compare', '(e) Blind: both columns, before Keep', () => drive.evaluate('1'))
    say(`  (e) blind, after ${String(ranFor)} s: ${JSON.stringify(shown)}`)
    const revealed = JSON.parse(String(await shoot('5-blind-reveal', '(e) Kept Model A: the names show', () => drive.evaluate(`(async () => {
      const keep = [...document.querySelectorAll('.lc-compare__foot button')].find((b) => b.innerText.trim() === 'Keep this one')
      if (!keep) return JSON.stringify({ compared: 'no Keep this one', names: [], bar: '' })
      if (keep.disabled) return JSON.stringify({ compared: 'Keep this one is disabled', names: [], bar: '' })
      keep.click()
      for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
      await new Promise((r) => setTimeout(r, 1000))
      const compared = document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      document.querySelector('.lc-compared__open')?.click()
      await new Promise((r) => setTimeout(r, 1200))
      return JSON.stringify({
        compared,
        names: [...document.querySelectorAll('.lc-compare__head .lc-compare__name')].map((el) => el.textContent.trim()),
        bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      })
    })()`))))
    say(`  (e) revealed: ${JSON.stringify(revealed)}`)
    const veiled = shown.names.join('|') === 'Model A|Model B' && !shown.shell.includes(NAME) && !/Muse|OpenCode|qwen/i.test(shown.shell)
    const done = shown.states.length === 2 && shown.states.every((state) => /done/.test(state))
    const named = revealed.names.length === 2 && revealed.names.includes(NAME) && revealed.names.some((name) => /Muse Spark/i.test(name))
    check('e', 'blind while it ran (Model A, Model B); both answered; after Keep the names show', veiled && done && named && /^You kept /.test(revealed.bar), `set up: ${setUp} || ${sent} || after ${String(ranFor)} s: ${JSON.stringify({ states: shown.states, names: shown.names, answers: shown.answers })} || kept: ${JSON.stringify(revealed)}`)
  }
} catch (error) {
  results.push('drive FAILED')
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  say(`RESULTS: ${results.join(' | ')}`)
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A real OpenAI-compatible server at ${BASE}, model ${MODEL}, added as "${NAME}".`, extra: `Results: ${results.join(' | ')}` })
}
process.exit(results.some((one) => /FAIL/.test(one)) ? 1 : 0)
