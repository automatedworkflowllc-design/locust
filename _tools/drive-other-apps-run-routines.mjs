// Another app runs Locust routines through the MCP server (0.704), end to end.
//
//   LOCUST_SPEND=1 node _tools/drive-other-apps-run-routines.mjs [--packaged <exe>]
//
// Colin, 10/08: "would be sick if we could actually integrate workflows from here". Two routines on the free
// model: "Echo twice" (Atlas, Ask, two steps, an input) and "Write a note" (Wren, Edit, an input). Through the
// real bridge over stdio, the way any MCP client speaks:
//   - list_routines says Echo can run from here and Write cannot, and why;
//   - with "Use each teammate's own mode" off, Write a note is refused and nothing starts;
//   - Echo twice runs with its input, routine_status walks it to the end, and the answer is its LAST step's;
//   - with own mode on, Write a note runs and its file lands in the workspace;
//   - Locust's own routine record counts both runs.
// Spends nothing but free-model turns (LOCUST_SPEND only because the turns run).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FREE_ROUTE, say, startDrive } from './drive-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.tmp', 'other-apps-routines')
await mkdir(scratch, { recursive: true })
const workspace = await mkdtemp(join(scratch, 'workspace-'))
const profile = await mkdtemp(join(scratch, 'profile-'))
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const route = (mode) => ({ ...FREE_ROUTE, mode })
const WORD = { key: 'word', label: 'The word', kind: 'text', required: true }
const ROUTINES = [
  { routineId: 'rt_echo', name: 'Echo twice', teammateId: 'tm_atlas', route: route('ask'), inputs: [WORD], learnedFrom: [], createdAt: '2026-10-08T02:00:00.000Z', runs: 0,
    steps: ['Reply with exactly the word {{word}} in capitals, and nothing else.', 'Reply with exactly the word {{word}} in lower case, and nothing else.'] },
  { routineId: 'rt_note', name: 'Write a note', teammateId: 'tm_wren', route: route('accept-edits'), inputs: [WORD], learnedFrom: [], createdAt: '2026-10-08T02:00:01.000Z', runs: 0,
    steps: ['Create a file named note.txt in the current folder containing exactly the word {{word}}. Then reply DONE.'] }
]

const drive = await startDrive({
  name: 'other-apps-run-routines', port: 9903, workspace, profilePath: profile, spends: true, keep: true,
  ...(packaged === undefined ? {} : { packaged }),
  outPath: join(scratch, new Date().toISOString().replace(/[:.]/g, '-')),
  focused: true,
  seed: { schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-08T00:00:00Z', route: route('accept-edits') },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-10-08T00:00:01Z', route: route('ask') }
    ],
    missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  },
  files: { 'routines.json': { schemaVersion: 1, routines: ROUTINES } }
})

let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${String(detail).slice(0, 300)}` : ''}`)
}
function bridgeCall(setup, name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(setup.node, [setup.bridge, setup.connection], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      const line = out.split('\n').find((part) => part.includes('"id":7'))
      if (line !== undefined) { child.kill(); resolve(JSON.parse(line).result) }
    })
    child.on('error', reject)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    setTimeout(() => { child.kill(); reject(new Error(`bridge: no answer to ${name}`)) }, 90_000)
  })
}
const textOf = (result) => result?.content?.map((part) => part.text).join('') ?? ''
const wait = async (expression, seconds = 30) => {
  for (let i = 0; i < seconds * 4; i += 1) {
    if (await drive.evaluate(expression)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${expression}`)
}
/** routine_status until the run ends. */
async function statusOf(setup, routine) {
  let said = ''
  const seen = []
  for (let i = 0; i < 90; i += 1) {
    said = textOf(await bridgeCall(setup, 'routine_status', { routine }))
    if (!/^Still working/.test(said)) break
    if (!seen.includes(said)) seen.push(said)
    await new Promise((resolve) => setTimeout(resolve, 4_000))
  }
  return { said, seen }
}

const SERVER = '[aria-label="Let your other AI apps use Locust"]'
const OWN = `[aria-label="Use each teammate's own mode"]`
try {
  await drive.ready()
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('${SERVER}:not(:disabled)')`)
  await drive.evaluate(`document.querySelector('${SERVER}').click()`)
  await wait(`document.querySelectorAll('.lc-mcp-setup').length === 2 && !!document.querySelector(\`${OWN}\`)`)
  const codex = await drive.evaluate(`[...document.querySelectorAll('.lc-mcp-setup')][1].innerText`)
  const args = JSON.parse(codex.match(/args = (\[.*\])/)[1])
  const setup = { node: JSON.parse(codex.match(/command = (".*")/)[1]), bridge: args[0], connection: args[1] }

  const listed = JSON.parse(textOf(await bridgeCall(setup, 'list_routines', {})))
  const echo = listed.find((r) => r.id === 'rt_echo')
  const note = listed.find((r) => r.id === 'rt_note')
  check('list_routines: Echo twice runs from here, two Ask steps by Atlas, with its input', echo?.runs_from_here === true && echo.steps.length === 2 && echo.steps.every((s) => s.teammate === 'Atlas' && s.mode === 'ask') && echo.inputs[0]?.key === 'word', JSON.stringify(echo))
  check('list_routines: Write a note changes files and does not run from here while own mode is off', note?.changes_files === true && note.runs_from_here === false && /own mode/.test(note.why_not ?? ''), JSON.stringify(note))

  const refused = await bridgeCall(setup, 'run_routine', { routine: 'Write a note', values: { word: 'PONG' } })
  check('off: Write a note is refused, and says how to allow it', refused.isError === true && /Use each teammate's own mode.*Nothing was started/.test(textOf(refused)), textOf(refused))

  const ran = JSON.parse(textOf(await bridgeCall(setup, 'run_routine', { routine: 'echo TWICE', values: { word: 'pebble' } })) || '{}')
  check('Echo twice starts through the routine run path', ran.routine_id === 'rt_echo' && ran.steps === 2 && /^mission_/.test(ran.first_conversation_id ?? ''), JSON.stringify(ran))
  const echoed = await statusOf(setup, 'rt_echo')
  say(`statuses seen: ${echoed.seen.join(' | ')}`)
  check('routine_status walked the steps', echoed.seen.some((s) => /step 1 of 2/.test(s)) || echoed.seen.some((s) => /step 2 of 2/.test(s)), echoed.seen.join(' | '))
  check('the answer is the LAST step\'s (lower case), not the first\'s', /^\s*pebble\s*\.?\s*$/.test(echoed.said), echoed.said)

  await drive.evaluate(`document.querySelector(\`${OWN}\`).click()`)
  await wait(`document.querySelector(\`${OWN}\`).getAttribute('aria-checked') === 'true'`)
  const relisted = JSON.parse(textOf(await bridgeCall(setup, 'list_routines', {})))
  check('on: Write a note now runs from here', relisted.find((r) => r.id === 'rt_note')?.runs_from_here === true)
  const wrote = JSON.parse(textOf(await bridgeCall(setup, 'run_routine', { routine: 'rt_note', values: { word: 'PONG' } })) || '{}')
  check('on: Write a note starts', wrote.routine_id === 'rt_note', JSON.stringify(wrote))
  const noted = await statusOf(setup, 'rt_note')
  const file = join(workspace, 'note.txt')
  const body = existsSync(file) ? (await readFile(file, 'utf8')).trim() : 'ABSENT'
  check('on: its file landed in the workspace, and the status brought its answer', /PONG/.test(body) && /DONE/i.test(noted.said), `file: ${body} · said: ${noted.said}`)

  const unknown = await bridgeCall(setup, 'routine_status', { routine: 'nothing-like-it' })
  check('an unknown routine is refused', unknown.isError === true, textOf(unknown))
  const record = JSON.parse(await readFile(join(profile, 'routines.json'), 'utf8'))
  const runs = Object.fromEntries(record.routines.map((r) => [r.routineId, r.runs]))
  check('Locust\'s own routine record counts each run', runs.rt_echo === 1 && runs.rt_note === 1, JSON.stringify(runs))
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Routines/.test(b.innerText))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await drive.capture('the Routines screen after two runs from another app', () => drive.evaluate(`(document.querySelector('main')?.innerText ?? '').split(/\\s+/).join(' ').slice(0, 300)`))
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('${SERVER}')`)
  await drive.evaluate(`document.querySelector('${SERVER}').click()`)
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`[FAIL] the drive stopped: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Another app lists and runs Locust routines through the MCP server, reading each to its end.' })
  say(failures === 0 ? `${String(checks)} / ${String(checks)} CHECKS PASSED` : `${String(failures)} of ${String(checks)} checks FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}
