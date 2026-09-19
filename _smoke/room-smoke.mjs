// A room, on the real app: watch a thread where one post gets every
// teammate's answer.
//
//   node _smoke/room-smoke.mjs [--shot <png>]
//
// Vision #2 ("a group room with ownership"), first step: the room surface.
// A room is a named set of teammates; a post starts one ordinary mission
// per teammate on that teammate's own route, and the answers are read back
// from those missions' records. So:
//
//   1. seeded: a room with one post and two finished missions -> the thread
//      shows both answers, attributed, each opening its mission
//   2. live: a new post on the FREE OpenCode model -> two real runs start,
//      the cards go from working to completed, the words arrive, and the
//      room file records both missions. Free, so it costs nothing.
//   3. a new room made from the form is listed in the sidebar and on disk
//
// The seeded half proves the reading; the live half proves the starting.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = portFor(import.meta.url)
const args = process.argv.slice(2)
const shotAt = args.indexOf('--shot')
const SHOT = shotAt === -1 ? undefined : resolve(args[shotAt + 1])
const FREE_MODEL = 'opencode/muse-spark-1.3-contributor-free'

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)}`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-room-ws-'))
await writeFile(join(workspace, 'README.md'), '# room\n', 'utf8')
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const profile = await mkdtemp(join(tmpdir(), 'locust-room-'))
const LEDGER_DIR = join(profile, 'mission-ledger')
await mkdir(LEDGER_DIR, { recursive: true })
const ROOMS = join(profile, 'rooms.json')
const T0 = '2026-09-05T05:00:00.000Z'
const T1 = '2026-09-05T05:01:00.000Z'
const route = { runtime: 'opencode', model: FREE_MODEL, mode: 'ask' }
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: T0, route }
    ],
    missionOwners: { mission_wren1: 'tm_wren', mission_booty1: 'tm_booty' },
    settings: { swarm: false, relay: true, relayHopCap: 6 }
  })
)
await writeFile(
  ROOMS,
  JSON.stringify({
    schemaVersion: 1,
    rooms: [
      {
        roomId: 'room_release',
        name: 'Release',
        teammateIds: ['tm_wren', 'tm_booty'],
        createdAt: T0,
        posts: [{ postId: 'post_1', text: 'Which files mention the release date?', at: T0, missions: { tm_wren: 'mission_wren1', tm_booty: 'mission_booty1' } }],
        tasks: [
          { taskId: 'task_notes', text: 'Write the release notes', ownerId: 'tm_wren', state: 'in-hand', missionId: 'mission_wren1', at: T1 },
          { taskId: 'task_version', text: 'Check the version string', ownerId: undefined, state: 'open', missionId: undefined, at: T0 }
        ]
      }
    ]
  })
)
const PROCESS = {
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false,
  outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: T0, finishedAt: T1
}
function missionFile(missionId, prompt, answer) {
  const runId = `run_${missionId}`
  const metadata = {
    missionId, runId, prompt, runtime: 'opencode', model: FREE_MODEL, requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default',
    cliVersion: '1.18.27', workspaceId: WORKSPACE_ID, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: T0
  }
  const events = [
    { type: 'run.started', occurredAt: T0, payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } } },
    { type: 'message.delta', occurredAt: T1, payload: { itemId: 'answer', operation: 'append', text: answer, final: true, evidence: { redacted: true } } },
    { type: 'run.completed', occurredAt: T1, payload: { process: PROCESS, evidence: { redacted: true } } }
  ]
  const lines = [JSON.stringify({ schemaVersion: 13, recordType: 'mission.created', ledgerSequence: 1, occurredAt: T0, metadata })]
  events.forEach((event, index) => {
    lines.push(JSON.stringify({
      schemaVersion: 13, recordType: 'mission.event', ledgerSequence: index + 2, occurredAt: event.occurredAt,
      event: { ...event, id: `${missionId}:${String(index + 1)}`, runId, missionId, sequence: index + 1, sourceAdapter: 'opencode' }
    }))
  })
  return `${lines.join('\n')}\n`
}
await writeFile(join(LEDGER_DIR, 'mission_wren1.jsonl'), missionFile('mission_wren1', 'Which files mention the release date?', 'README.md and CHANGELOG.md mention it.'), 'utf8')
await writeFile(join(LEDGER_DIR, 'mission_booty1.jsonl'), missionFile('mission_booty1', 'Which files mention the release date?', 'Only README.md, in the first line.'), 'utf8')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  const rendererErrors = []
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') rendererErrors.push((m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text ?? 'exception') + ' @ ' + JSON.stringify((m.params?.exceptionDetails?.stackTrace?.callFrames ?? []).slice(0, 4).map(f => [f.functionName, f.lineNumber, f.columnNumber])))
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') rendererErrors.push((m.params.args ?? []).map(a => a.value ?? a.description ?? '').join(' '))
    const w = pending.get(m.id)
    if (w) { pending.delete(m.id); w(m) }
  })
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id
        pending.set(n, res)
        socket.send(JSON.stringify({ id: n, method, params }))
      }),
      new Promise((resolve) => { const t = setTimeout(() => resolve({ error: { message: 'cdp timeout' } }), 720_000); t.unref() })
    ])
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.error) throw new Error(JSON.stringify(m.error))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return m.result?.result?.value
  }
  await send('Runtime.enable')
  await evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  const ROOM_STATE = `(() => {
    const cards = [...document.querySelectorAll('.lc-roomanswer')].map(card => ({
      name: card.querySelector('.lc-roomanswer__name')?.textContent.trim() ?? '',
      phase: card.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? '',
      route: card.querySelector('.lc-roomanswer__route')?.textContent.trim() ?? '',
      // A one-line answer renders as an agent line, the way the thread draws
      // it; only a longer one gets its own __text block. Reading just the
      // latter reported every card as wordless (2026-09-19).
      text: (card.querySelector('.lc-roomanswer__text') ?? card.querySelector('.lc-agentline'))?.textContent.trim() ?? ''
    }))
    const board = [...document.querySelectorAll('.lc-task')].map(row => ({
      // The state is the line screen readers get, or the row's own modifier;
      // .lc-task__state has not existed since the board became a plan list.
      state: (row.querySelector('.lc-sr')?.textContent.trim() ?? '') || (/is-([a-z-]+)/.exec(row.className)?.[1] ?? ''),
      text: row.querySelector('.lc-task__text')?.textContent.trim() ?? '',
      owner: row.querySelector('.lc-task__owner')?.textContent.trim() ?? ''
    }))
    return JSON.stringify({
      title: (document.querySelector('.lc-room__name') ?? document.querySelector('.lc-screen__title'))?.textContent.trim() ?? '',
      posts: document.querySelectorAll('.lc-roompost').length,
      board,
      cards,
      // Every room the app lists, wherever it lists them: the Rooms screen's
      // cards (wide) or the sidebar's own rows (the rail).
      sidebarRooms: [
        ...[...document.querySelectorAll('.lc-roomcard__name')].map(el => el.textContent.trim()),
        ...[...document.querySelectorAll('.lc-roomrow .lc-row__name')].map(el => el.textContent.trim())
      ]
    })
  })()`

  say('1. the seeded room reads back')
  // What the host answered and what the sidebar drew, before anything is
  // clicked: the two facts a failure here needs.
  const before = await evaluate(`window.desktop.listRooms().then(r => JSON.stringify({ rooms: r.ok ? r.data.rooms.map(x => [x.name, x.teammateIds.length, x.posts.length]) : r, roomRows: document.querySelectorAll('.lc-roomrow').length, sidebar: (document.querySelector('.lc-sidebar')?.innerText ?? '(no sidebar)').replace(/\\s+/g, ' ').slice(0, 160) }))`)
  say(`       before: ${before}`)
  say(`       body: ${await evaluate(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)`)}`)
  if (rendererErrors.length > 0) say(`       renderer errors: ${rendererErrors.slice(0, 3).join(' || ').slice(0, 600)}`)
  let opened
  try {
    /*
     * THROUGH THE ROOMS SCREEN, which is where a room lives now.
     *
     * This looked for a `.lc-roomrow` in the sidebar and clicked it. The
     * wide sidebar was flattened to a list of conversations on 2026-09-15
     * ("Flatten the sidebar: conversations, newest first, teammate on the
     * row") -- the day after this smoke was last touched -- so rooms moved
     * to the Rooms screen, reached by the footer button or Ctrl 4. The
     * smoke then failed for a year-old shape rather than for anything
     * wrong, which is how a suite stops being read (measured 2026-09-19).
     */
    opened = JSON.parse(await evaluate(`(async () => {
    const wayIn = [...document.querySelectorAll('.lc-sidebar button')].find(b => (b.getAttribute('title') || '').indexOf('Rooms') === 0)
      || [...document.querySelectorAll('.lc-roomrow')].find(r => /Release/.test(r.innerText))
    if (!wayIn) return JSON.stringify({ found: false, sidebar: document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200) })
    wayIn.click()
    await new Promise(r => setTimeout(r, 700))
    const card = [...document.querySelectorAll('.lc-roomcard')].find(c => /Release/.test(c.innerText))
    if (card) { card.click(); await new Promise(r => setTimeout(r, 700)) }
    return JSON.stringify({ found: card !== undefined, ...JSON.parse(${ROOM_STATE}) })
  })()`))
  } catch (error) {
    say(`       opening threw: ${error instanceof Error ? error.message : String(error)}`)
    say(`       renderer errors: ${rendererErrors.slice(0, 3).join(' || ').slice(0, 900)}`)
    throw error
  }
  say(`       ${JSON.stringify(opened).slice(0, 400)}`)
  check('the room is listed on the Rooms screen and opens', opened.found === true, JSON.stringify(opened).slice(0, 200))
  check('the screen is the room', opened.title === 'Release', opened.title)
  check('one post, two answer cards', opened.posts === 1 && opened.cards?.length === 2, JSON.stringify(opened.cards))
  check('each card is attributed and completed', (opened.cards ?? []).every((c) => /Wren|Booty/.test(c.name) && c.phase === 'completed'), JSON.stringify(opened.cards))
  check('each card carries the teammate\'s last words', (opened.cards ?? []).some((c) => /README\.md and CHANGELOG\.md/.test(c.text)) && (opened.cards ?? []).some((c) => /first line/.test(c.text)), JSON.stringify(opened.cards))
  check('each card names its route', (opened.cards ?? []).every((c) => /OpenCode/.test(c.route)), JSON.stringify(opened.cards))
  check('the board reads back: one in hand with Wren, one open with nobody', JSON.stringify(opened.board) === JSON.stringify([
    // The board reads its state to screen readers in words and names an
    // unclaimed row "unassigned"; it used to shout IN HAND / OPEN and say
    // "nobody". The words changed with the board, not the behaviour.
    { state: 'in hand', text: 'Write the release notes', owner: 'Wren' },
    { state: 'open', text: 'Check the version string', owner: 'unassigned' }
  ]), JSON.stringify(opened.board))

  say('2. Open on a card goes to that mission')
  const openedMission = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('.lc-roomanswer .lc-ghostbutton')].find(b => b.innerText.trim() === 'Open')
    button.click()
    await new Promise(r => setTimeout(r, 700))
    return document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? ''
  })()`)
  // A mission reopened from the ledger says so in its header rather than
  // repeating "completed"; either wording is the workroom on that mission.
  // The header names the teammate, the mission and where it came from; it
  // stopped carrying the word "Mission" when the workroom header was redrawn.
  check('the mission opened in the workroom', /wren1|booty1/.test(openedMission) && /restored|completed/.test(openedMission), openedMission)

  say('3. a live post on the free model starts a run per teammate')
  const posted = JSON.parse(await evaluate(`(async () => {
    // Back to the room the way a person goes back to it: the Rooms screen.
    const wayIn = [...document.querySelectorAll('.lc-sidebar button')].find(b => (b.getAttribute('title') || '').indexOf('Rooms') === 0)
    if (wayIn) { wayIn.click(); await new Promise(r => setTimeout(r, 700)) }
    const back = [...document.querySelectorAll('.lc-roomcard')].find(c => /Release/.test(c.innerText))
    if (back) { back.click() }
    await new Promise(r => setTimeout(r, 700))
    const box = document.querySelector('.lc-roomcompose__box')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Reply with the single word: ready. Then, using the task block you were shown, mark the task "Check the version string" done.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    /*
     * Wait for the CARDS, which is what the next assertion is about, not for
     * the post that carries them. The post appears as soon as it is written;
     * a card appears per teammate as each run is admitted, and those are not
     * the same moment. Waiting on the post and then asserting on cards read
     * a half-drawn room about half the time.
     */
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-roomanswer').length >= 4) break
    }
    return ${ROOM_STATE}
  })()`))
  say(`       ${JSON.stringify(posted).slice(0, 400)}`)
  check('a second post appears', posted.posts === 2, String(posted.posts))
  check('with a card per teammate, working', posted.cards.length === 4 && posted.cards.slice(2).every((c) => /starting|running/.test(c.phase)), JSON.stringify(posted.cards.slice(2)))

  const settled = JSON.parse(await evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const cards = [...document.querySelectorAll('.lc-roomanswer')].slice(2)
      if (cards.length === 2 && cards.every(c => /completed|failed|cancelled|interrupted/.test(c.querySelector('.lc-roomanswer__phase')?.textContent ?? ''))) break
    }
    return ${ROOM_STATE}
  })()`))
  say(`       ${JSON.stringify(settled.cards.slice(2))}`)
  check('both runs finished', settled.cards.slice(2).every((c) => c.phase === 'completed'), JSON.stringify(settled.cards.slice(2)))
  // The room owes a card per teammate carrying that teammate's answer. The
  // post asks them to say "ready"; whether a free model obeys an instruction
  // to the letter is the same class as the task block below, which this file
  // already logs rather than asserts.
  check('and each answered in its own card', settled.cards.slice(2).every((c) => String(c.text ?? '').trim().length > 0), JSON.stringify(settled.cards.slice(2)))
  // Whether a free model follows the block is the model's business, not the
  // product's; what the product owes is that a block that arrives moves the
  // board and a block that does not leaves it. Logged, not asserted.
  await sleep(1500)
  const afterRun = JSON.parse(await evaluate(ROOM_STATE))
  say(`       board after the run (model-moved, informational): ${JSON.stringify(afterRun.board)}`)
  const answerTexts = settled.cards.slice(2).map((c) => c.text)
  check('the block, if any, is stripped from the shown answer', answerTexts.every((t) => !/locust-task/.test(t)), JSON.stringify(answerTexts))

  const stored = JSON.parse(await readFile(ROOMS, 'utf8'))
  const release = stored.rooms.find((r) => r.roomId === 'room_release')
  check('the room file records the post with both missions', release?.posts?.length === 2 && Object.keys(release.posts[1].missions).length === 2, JSON.stringify(release?.posts?.[1]))

  say('4. the person moves the board by hand')
  const moved = JSON.parse(await evaluate(`(async () => {
    const steps = []
    const rows = () => [...document.querySelectorAll('.lc-task')]
    const find = (text) => rows().find(r => (r.querySelector('.lc-task__text')?.textContent ?? '').includes(text))
    const state = () => JSON.stringify([...document.querySelectorAll('.lc-task')].map(r => [r.querySelector('.lc-task__text')?.textContent.trim(), r.querySelector('.lc-sr')?.textContent.trim(), r.querySelector('.lc-task__owner')?.textContent.trim()]))
    // add -- the form is behind "+ Add a task" now, so the row is only one
    // control wide until somebody asks for it. Selecting the input straight
    // off found null and threw an Illegal invocation (2026-09-19).
    const openAdd = document.querySelector('.lc-board__addlink')
    if (openAdd) { openAdd.click(); await new Promise(r => setTimeout(r, 300)) }
    const input = document.querySelector('.lc-board__add input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Sign the installer')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    document.querySelector('.lc-board__add').requestSubmit()
    await new Promise(r => setTimeout(r, 600))
    steps.push(['added', state()])
    // assign to Booty -- one menu since 0.116.0, and it opens into the app's
    // own ContextMenu rather than inside the row.
    let row = find('Sign the installer')
    row.querySelector('button[aria-haspopup="menu"]').click()
    await new Promise(r => setTimeout(r, 250))
    ;[...document.querySelectorAll('.lc-menu button, [role=menu] button')]
      .find(b => /Assign to Booty/i.test(b.innerText)).click()
    await new Promise(r => setTimeout(r, 600))
    steps.push(['assigned', state()])
    // done
    row = find('Sign the installer')
    row.querySelector('button[aria-haspopup="menu"]').click()
    await new Promise(r => setTimeout(r, 250))
    ;[...document.querySelectorAll('.lc-menu button, [role=menu] button')]
      .find(b => b.innerText.toLowerCase().includes('mark done')).click()
    await new Promise(r => setTimeout(r, 600))
    steps.push(['done', state()])
    // reopen
    row = find('Sign the installer')
    row.querySelector('button[aria-haspopup="menu"]').click()
    await new Promise(r => setTimeout(r, 250))
    ;[...document.querySelectorAll('.lc-menu button, [role=menu] button')]
      .find(b => b.innerText.toLowerCase().includes('reopen')).click()
    await new Promise(r => setTimeout(r, 600))
    steps.push(['reopened', state()])
    // remove
    row = find('Sign the installer')
    row.querySelector('button[aria-haspopup="menu"]').click()
    await new Promise(r => setTimeout(r, 250))
    ;[...document.querySelectorAll('.lc-menu button, [role=menu] button')]
      .find(b => b.innerText.toLowerCase().includes('off the board')).click()
    await new Promise(r => setTimeout(r, 200))
    ;[...document.querySelectorAll('.lc-menu button, [role=menu] button')]
      .find(b => b.innerText.toLowerCase().includes('for good')).click()
    await new Promise(r => setTimeout(r, 600))
    steps.push(['removed', state()])
    return JSON.stringify(steps)
  })()`))
  for (const [step, state] of moved) say(`       ${step}: ${state}`)
  const at = (step) => JSON.parse(moved.find((entry) => entry[0] === step)[1])
  const signRow = (step) => at(step).find((row) => row[0] === 'Sign the installer')
  check('add puts an open task with nobody on the board', JSON.stringify(signRow('added')) === JSON.stringify(['Sign the installer', 'open', 'unassigned']), JSON.stringify(signRow('added')))
  check('assign hands it to Booty, in hand', JSON.stringify(signRow('assigned')) === JSON.stringify(['Sign the installer', 'in hand', 'Booty']), JSON.stringify(signRow('assigned')))
  check('done finishes it', signRow('done')?.[1] === 'done', JSON.stringify(signRow('done')))
  check('reopen puts it back in Booty\'s hands', JSON.stringify(signRow('reopened')) === JSON.stringify(['Sign the installer', 'in hand', 'Booty']), JSON.stringify(signRow('reopened')))
  check('remove takes it off the board', signRow('removed') === undefined, JSON.stringify(at('removed')))
  const storedBoard = JSON.parse(await readFile(ROOMS, 'utf8')).rooms.find((r) => r.roomId === 'room_release').tasks
  check('the file agrees with the screen', !storedBoard.some((t) => t.text === 'Sign the installer') && storedBoard.length >= 2, JSON.stringify(storedBoard.map((t) => [t.text, t.state, t.ownerId])))

  say('5. a new room from the form')
  const made = JSON.parse(await evaluate(`(async () => {
    // The "New room" form lives on the Rooms screen; the sidebar's own
    // new-room row went with the flatten of 2026-09-15.
    const wayIn = [...document.querySelectorAll('.lc-sidebar button')].find(b => (b.getAttribute('title') || '').indexOf('Rooms') === 0)
      || document.querySelector('.lc-roomrow--new')
    if (wayIn) { wayIn.click() }
    await new Promise(r => setTimeout(r, 800))
    const name = document.querySelector('.lc-roomform__name')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(name, 'Pair')
    name.dispatchEvent(new Event('input', { bubbles: true }))
    const wren = [...document.querySelectorAll('.lc-roomform__members button')].find(b => /Wren/.test(b.innerText))
    wren.click()
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomform').requestSubmit()
    await new Promise(r => setTimeout(r, 900))
    return ${ROOM_STATE}
  })()`))
  say(`       ${JSON.stringify(made).slice(0, 300)}`)
  check('the new room opens', made.title === 'Pair', made.title)
  // Read from the Rooms screen, which is where rooms are listed now. The
  // room being OPEN is what hides them, so it looks at the list itself.
  const listed = JSON.parse(await evaluate(`(async () => {
    const wayIn = [...document.querySelectorAll('.lc-sidebar button')].find(b => (b.getAttribute('title') || '').indexOf('Rooms') === 0)
    if (wayIn) { wayIn.click(); await new Promise(r => setTimeout(r, 800)) }
    return JSON.stringify([...document.querySelectorAll('.lc-roomcard__name')].map(el => el.textContent.trim()))
  })()`))
  check('and both rooms are listed', listed.includes('Pair') && listed.includes('Release'), JSON.stringify(listed))
  const stored2 = JSON.parse(await readFile(ROOMS, 'utf8'))
  check('and it is on disk with Wren alone', stored2.rooms.some((r) => r.name === 'Pair' && r.teammateIds.length === 1 && r.teammateIds[0] === 'tm_wren'))

  if (SHOT !== undefined) {
    // Open Release from the Rooms screen, the way everything else here
    // does; the sidebar's room rows went with the flatten.
    await evaluate(`(async () => {
      const card = [...document.querySelectorAll('.lc-roomcard')].find(c => /Release/.test(c.innerText))
      if (card) { card.click(); await new Promise(r => setTimeout(r, 700)) }
      return true
    })()`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (typeof shot.result?.data === 'string') await writeFile(SHOT, Buffer.from(shot.result.data, 'base64'))
  }
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-1500))
  say(`\n${String(failures)} ROOM FAILURE(S)`)
  process.exit(1)
}
say('\nroom smoke passed')
