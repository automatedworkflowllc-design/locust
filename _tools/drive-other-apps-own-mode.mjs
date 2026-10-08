// "Use each teammate's own mode" (0.703): another app's turn runs in the teammate's mode, end to end.
//
//   LOCUST_SPEND=1 node _tools/drive-other-apps-own-mode.mjs [--packaged <exe>]
//
// A throwaway profile with three teammates on the free model: Wren (Edit), Ash (Approve each) and
// Kit (Auto, with Auto off in Settings). The drive turns the server on in Settings, speaks to the
// bridge directly over stdio the way any MCP client does, and checks:
//   - the new switch is there, off; Wren's turn from outside is still Ask;
//   - on, Wren's turn is Edit and her file lands in the workspace; the thread says Edit;
//   - Kit's Auto is refused with Locust's own sentence, since Auto is off in Settings;
//   - Ash's card waits in Locust's window, read_reply says so, and the card is DENIED in the window;
//   - after a restart the switch is still on; turned off, the next turn is Ask again.
//
// Spends nothing but free-model turns (LOCUST_SPEND only because the turns run).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FREE_ROUTE, say, startDrive } from './drive-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.tmp', 'other-apps-own-mode')
await mkdir(scratch, { recursive: true })
const workspace = await mkdtemp(join(scratch, 'workspace-'))
const profile = await mkdtemp(join(scratch, 'profile-'))
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const outPath = join(scratch, new Date().toISOString().replace(/[:.]/g, '-'))
const route = (mode) => ({ ...FREE_ROUTE, mode })
const options = (extra) => ({ name: 'other-apps-own-mode', port: 9899, workspace, profilePath: profile, spends: true, keep: true, outPath,
  ...(packaged === undefined ? {} : { packaged }), ...extra })

let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${String(detail).slice(0, 300)}` : ''}`)
}

/** The bridge, spoken to directly over stdio: one JSON-RPC request, one answer. */
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

const SERVER = '[aria-label="Let your other AI apps use Locust"]'
const OWN = `[aria-label="Use each teammate's own mode"]`
async function openSettings(drive) {
  const wait = waiter(drive)
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Settings/.test(b.innerText))?.click()`)
  await wait(`!!document.querySelector('${SERVER}:not(:disabled)')`)
}
const waiter = (drive) => async (expression, seconds = 30) => {
  for (let i = 0; i < seconds * 4; i += 1) {
    if (await drive.evaluate(expression)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out: ${expression}`)
}
async function setupOf(drive) {
  const codex = await drive.evaluate(`[...document.querySelectorAll('.lc-mcp-setup')][1]?.innerText ?? ''`)
  const command = JSON.parse(codex.match(/command = (".*")/)[1])
  const args = JSON.parse(codex.match(/args = (\[.*\])/)[1])
  return { node: command, bridge: args[0], connection: args[1] }
}
/** Poll read_reply until the turn ends; `onWaiting` runs once if a card is said to be waiting. */
async function replyOf(setup, conversation, onWaiting) {
  let reply = ''
  let waited = false
  for (let i = 0; i < 72; i += 1) {
    reply = textOf(await bridgeCall(setup, 'read_reply', { conversation_id: conversation }))
    if (/^Waiting for the person to approve/.test(reply) && !waited) { waited = true; await onWaiting?.(reply) }
    if (!/^Still working|^Waiting for the person/.test(reply)) break
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  return { reply, waited }
}
const started = (result) => { try { return JSON.parse(textOf(result)) } catch { return { error: textOf(result) } } }

let drive = await startDrive(options({
  focused: true,
  seed: { schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-08T00:00:00Z', route: route('accept-edits') },
      { teammateId: 'tm_ash', name: 'Ash', hue: 'blue', role: 'Code & Migrations', createdAt: '2026-10-08T00:00:00Z', route: route('approve-each') },
      { teammateId: 'tm_kit', name: 'Kit', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-10-08T00:00:00Z', route: route('auto') }
    ],
    missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
}))
let setup
try {
  await drive.ready()
  const wait = waiter(drive)
  await openSettings(drive)
  check('the own-mode switch is not offered while the server is off', await drive.evaluate(`!document.querySelector(\`${OWN}\`)`))
  await drive.evaluate(`document.querySelector('${SERVER}').click()`)
  await wait(`document.querySelector('${SERVER}').getAttribute('aria-checked') === 'true' && document.querySelectorAll('.lc-mcp-setup').length === 2 && !!document.querySelector(\`${OWN}\`)`)
  const offLine = await drive.capture('the server on; own mode offered, off', () => drive.evaluate(`document.querySelector(\`${OWN}\`).closest('.lc-settingline').innerText`))
  check('own mode starts off and says turns are Ask', await drive.evaluate(`document.querySelector(\`${OWN}\`).getAttribute('aria-checked') === 'false'`) && /Ask mode \(read only\)/.test(offLine), offLine)
  setup = await setupOf(drive)

  const listedOff = JSON.parse(textOf(await bridgeCall(setup, 'list_teammates', {})))
  check('off: every teammate runs_in ask', listedOff.length === 3 && listedOff.every((t) => t.runs_in === 'ask'), JSON.stringify(listedOff.map((t) => [t.name, t.runs_in])))
  const askTurn = started(await bridgeCall(setup, 'start_conversation', { teammate: 'Wren', message: 'Reply with the single word PONG and nothing else.', mode: 'auto' }))
  check('off: Wren (usually Edit) starts in Ask, whatever the caller asks for', askTurn.mode === 'ask', JSON.stringify(askTurn))
  if (askTurn.conversation_id !== undefined) await replyOf(setup, askTurn.conversation_id)

  await drive.evaluate(`document.querySelector(\`${OWN}\`).click()`)
  await wait(`document.querySelector(\`${OWN}\`).getAttribute('aria-checked') === 'true'`)
  const onLine = await drive.capture('own mode on', () => drive.evaluate(`document.querySelector(\`${OWN}\`).closest('.lc-settingline').innerText`))
  check('on: the switch says approvals stay in this window and Auto follows Settings', /only you can answer them/.test(onLine) && /Auto runs only if Auto is on in Settings/.test(onLine), onLine)
  const listedOn = Object.fromEntries(JSON.parse(textOf(await bridgeCall(setup, 'list_teammates', {}))).map((t) => [t.name, t.runs_in]))
  check('on: runs_in is each teammate\'s own mode', listedOn.Wren === 'accept-edits' && listedOn.Ash === 'approve-each' && listedOn.Kit === 'auto', JSON.stringify(listedOn))

  // Edit: the file lands in the workspace.
  const editTurn = started(await bridgeCall(setup, 'start_conversation', { teammate: 'Wren', message: 'Create a file named from-another-app.txt in the current folder containing exactly the word PONG. Then reply DONE.', mode: 'ask' }))
  check('on: Wren starts in her own mode, Edit, though the caller asked for Ask', editTurn.mode === 'accept-edits', JSON.stringify(editTurn))
  if (editTurn.conversation_id !== undefined) {
    const { reply } = await replyOf(setup, editTurn.conversation_id)
    const file = join(workspace, 'from-another-app.txt')
    const body = existsSync(file) ? (await readFile(file, 'utf8')).trim() : 'ABSENT'
    check('on: the Edit turn wrote its file in the workspace', /PONG/.test(body), `file: ${body} · reply: ${reply.slice(0, 120)}`)
    const record = await drive.evaluate(`window.desktop.getMissionHistory().then(h => h.ok ? h.data.missions.map(m => ({ id: m.missionId, mode: m.mode, startedBy: m.startedBy?.kind })) : [])`)
    const mine = record.find((row) => row.id === editTurn.conversation_id)
    check('Locust\'s history records the turn as from another app, in Edit', mine?.startedBy === 'mcp' && mine?.mode === 'accept-edits', JSON.stringify(mine))
  }

  // Auto, with Auto off in Settings: Locust's own refusal, nothing started.
  const autoTurn = await bridgeCall(setup, 'start_conversation', { teammate: 'Kit', message: 'Reply PONG.' })
  check('on: Kit\'s Auto is refused because Auto is off in Settings', autoTurn.isError === true && /Auto mode is switched off/.test(textOf(autoTurn)), textOf(autoTurn))

  // Approve each: the card waits in Locust's window; read_reply says so; it is denied there.
  const ashTurn = started(await bridgeCall(setup, 'start_conversation', { teammate: 'Ash', message: 'Run exactly this shell command with your bash tool: echo FROM-OUTSIDE > outside.txt   If it is declined, do not try another way; say so in one sentence.' }))
  check('on: Ash starts in Approve each', ashTurn.mode === 'approve-each', JSON.stringify(ashTurn))
  if (ashTurn.conversation_id !== undefined) {
    let denied = 'no card was answered'
    const { reply, waited } = await replyOf(setup, ashTurn.conversation_id, async (said) => {
      say(`read_reply while waiting: ${said}`)
      // Open the conversation in Locust and answer the card there, the only place it can be answered.
      await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find(b => /Conversations|Home/.test(b.innerText))?.click()`)
      await wait(`[...document.querySelectorAll('.lc-conv')].length > 0`)
      await drive.evaluate(`[...document.querySelectorAll('.lc-conv')].find(r => /Ash/.test(r.innerText + (r.getAttribute('title') ?? '')))?.click() ?? [...document.querySelectorAll('.lc-conv')][0].click()`)
      await wait(`!!document.querySelector('[role=group][aria-label="Approval required"]')`, 60)
      denied = await drive.capture('Ash\'s card, in Locust\'s window, for a turn another app started', () => drive.evaluate(`(async () => {
        const card = () => document.querySelector('[role=group][aria-label="Approval required"]')
        const words = card().innerText.split(/\\s+/).join(' ').slice(0, 160)
        // The first Deny opens the "Why?" field; the second sends the answer. Every card of the
        // run is denied the same way until none is left.
        for (let i = 0; i < 40 && card(); i += 1) {
          card().querySelector('button.lc-denybutton')?.click()
          await new Promise((r) => setTimeout(r, 600))
        }
        return (card() ? 'STILL WAITING: ' : '') + words
      })()`))
    })
    check('read_reply said a card was waiting in Locust\'s window', waited)
    check('the card was in Locust\'s window and was denied there', /echo|FROM-OUTSIDE|outside/i.test(denied) && !/^STILL WAITING/.test(denied), denied)
    check('after the denial the turn ended, and read_reply brought its answer back', !/^Still working|^Waiting for the person/.test(reply), reply.slice(0, 200))
    check('the denied command did not run', !existsSync(join(workspace, 'outside.txt')))
    const marker = await drive.evaluate(`[...document.querySelectorAll('.lc-thread__marker')].map(m => m.innerText).join(' | ')`)
    check('the thread says it was started from another app, in Approve each', /Started from another app · Approve each action/i.test(marker), marker)
  }
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`[FAIL] the drive stopped: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Another app starts teammates through the MCP server with "Use each teammate\'s own mode" on and off.' })
}

// After a restart: still on; turned off, the next turn is Ask.
try {
  drive = await startDrive(options({ stepFrom: 100, keep: false, focused: true }))
  await drive.ready()
  const wait = waiter(drive)
  await openSettings(drive)
  await wait(`!!document.querySelector(\`${OWN}\`)`)
  check('after a restart the switch is still on', await drive.evaluate(`document.querySelector(\`${OWN}\`).getAttribute('aria-checked') === 'true'`))
  setup = await setupOf(drive)
  await drive.evaluate(`document.querySelector(\`${OWN}\`).click()`)
  await wait(`document.querySelector(\`${OWN}\`).getAttribute('aria-checked') === 'false'`)
  await drive.capture('own mode off again', () => drive.evaluate(`document.querySelector(\`${OWN}\`).closest('.lc-settingline').innerText`))
  const back = started(await bridgeCall(setup, 'start_conversation', { teammate: 'Wren', message: 'Reply with the single word PONG and nothing else.' }))
  check('turned off, Wren\'s next turn is Ask again', back.mode === 'ask', JSON.stringify(back))
  if (back.conversation_id !== undefined) await replyOf(setup, back.conversation_id)
  await drive.evaluate(`document.querySelector('${SERVER}').click()`)
} catch (error) {
  failures += 1
  say(`[FAIL] the relaunch stopped: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The same profile after a restart.' })
  say(failures === 0 ? `${String(checks)} / ${String(checks)} CHECKS PASSED` : `${String(failures)} of ${String(checks)} checks FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}
