// A conversation switched to another runtime partway through: does the new one know what was said,
// and does the thread show where the switch happened -- live, and after the app is opened again?
//
//   LOCUST_SPEND=1 node _tools/drive-runtime-switch.mjs --packaged <exe> [--tag <name>] [--to opencode|claude]
//
// The beta handover asked for "a runtime switch mid-conversation" among the
// site's shots, and for which runtimes can hand off to which.
//
// Between turns, a reply on another runtime is a handoff without the stop
// (codex-mission.ts, 'route-switch'): the earlier mission is reconciled, and a
// briefing of what was done starts the new runtime with the reply as the
// latest word. The thread is meant to draw the handoff divider there.
//
// The first run, on packaged 0.309 (Codex -> Claude Code / Haiku): the word
// came across ("marigold") but there was NO divider. The live start receipt
// for a reply on another runtime says nothing of the switch, so the window
// has nothing to draw; only a conversation rebuilt from the record gets one
// (stitchedHandoff). So this drive now reads the thread twice -- live, and
// after quitting and opening the app again on the same profile -- in the
// order a person reads it: their messages, the teammate's lines, the divider.
//
// Wren on Codex (GPT-6-Luna, low, Ask) is given a word to keep; the chip is
// switched the way a person does it -- to a free OpenCode model by default,
// so the drive costs one short Codex turn; `--to claude` switches to Claude
// Code / Haiku instead -- and Wren is asked for the word. Read-only, nothing
// written. Each state is captured at 1920x1080 too.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const to = arg('--to') ?? 'opencode'
const TARGETS = {
  opencode: { group: '/opencode/i', search: 'free', row: '/free/i', chip: /^OpenCode/i, name: 'OpenCode' },
  claude: { group: '/claude/i', search: 'haiku', row: '/haiku/i', chip: /^Claude.*Haiku/i, name: 'Claude Code' }
}
const target = TARGETS[to]
if (target === undefined) {
  say(`--to must be one of ${Object.keys(TARGETS).join(', ')}`)
  process.exit(1)
}
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `runtime-switch-${tag}`)
await mkdir(OUT, { recursive: true })

const WORD = 'marigold'
const FIRST = `Remember this word for later in our conversation: ${WORD}. Reply with just: OK. Change nothing.`
const SECOND = 'What word did I ask you to remember earlier in this conversation? Answer with just the word. Change nothing.'
const workspace = await scratchRepository('locust-runtime-switch-ws-')
const launch = (more) => startDrive({
  name: `runtime-switch-${tag}`,
  port: 9519,
  workspace,
  outPath: OUT,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...more
})
let drive = await launch({
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'low' } }
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

const ROUTE = `(() => ([...document.querySelectorAll('button.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim())()`
// The thread as a person reads it, top to bottom: what they said (their
// bubbles), what the teammate said (its lines), and the divider. Their own
// messages hold "OK" and the word, so a check on the whole thread's text would
// pass whatever the teammates said; each line is kept apart instead.
const THREAD = `(() => JSON.stringify([...document.querySelectorAll('.lc-thread .lc-bubble, .lc-thread .lc-agentline__body, .lc-thread .lc-handoff')].map((node) => ({
  kind: node.classList.contains('lc-bubble') ? 'you' : node.classList.contains('lc-handoff') ? 'divider' : 'teammate',
  text: (node.classList.contains('lc-handoff') ? (node.getAttribute('aria-label') ?? '') + ' | ' : '') + node.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160)
}))))()`
const thread = async () => JSON.parse(String(await drive.evaluate(THREAD)))
const said = (rows) => rows.map((row) => `${row.kind}: ${row.text}`).join(' / ')

// What a person should see, in this order: the first message and Codex's OK;
// then the seam; then the question and the answer on the new runtime.
const inOrder = (rows) => {
  const at = (test) => rows.findIndex(test)
  const first = at((row) => row.kind === 'you' && row.text.startsWith('Remember this word'))
  const ok = at((row, index) => index > first && row.kind === 'teammate' && /\bOK\b/i.test(row.text))
  const divider = at((row) => row.kind === 'divider')
  const second = at((row) => row.kind === 'you' && row.text.startsWith('What word did I ask'))
  const answer = at((row, index) => index > second && row.kind === 'teammate' && new RegExp(WORD, 'i').test(row.text))
  return { first, ok, divider, second, answer, right: first >= 0 && first < ok && ok < divider && divider < second && second < answer }
}

const openWren = () => drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 1500)) })()`)
const wide = async (what) => {
  await drive.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  await drive.capture(what, () => drive.evaluate(THREAD))
  await drive.send('Emulation.clearDeviceMetricsOverride', {})
}

let handover
try {
  await drive.ready()
  await drive.resize(1215, 800)
  await openWren()
  const before = String(await drive.evaluate(ROUTE))
  const onCodex = /^Codex/i.test(before) && /GPT-6[- ]Luna/i.test(before)
  check('Wren starts on Codex / GPT-6-Luna, as seeded', onCodex, before)
  if (!onCodex) throw new Error('refusing to send: the route is not what was seeded')

  await drive.capture('turn 1 on Codex: a word to keep', () => drive.evaluate(sendAndWaitScript(FIRST, { waitSeconds: 240 })))
  const afterFirst = (await thread()).filter((row) => row.kind === 'teammate')
  check('Codex answered the first turn, without the word', afterFirst.length > 0 && /\bOK\b/i.test(afterFirst[afterFirst.length - 1].text) && !new RegExp(WORD, 'i').test(afterFirst.map((row) => row.text).join(' ')), JSON.stringify(afterFirst))

  const picked = String(await drive.capture(`switch the chip to ${target.name}`, () => drive.evaluate(pickRouteScript({ group: target.group, search: target.search, row: target.row }))))
  await sleep(800)
  const after = String(await drive.evaluate(ROUTE))
  check(`the chip now reads ${target.name}`, target.chip.test(after), `${after} || ${picked.slice(0, 200)}`)

  await drive.capture(`turn 2 on ${target.name}: what was the word?`, () => drive.evaluate(sendAndWaitScript(SECOND, { waitSeconds: 300 })))
  const live = await thread()
  const fresh = live.filter((row) => row.kind === 'teammate').slice(afterFirst.length)
  check(`${target.name}, on the new runtime, knows the word said on Codex ("${WORD}")`, fresh.length > 0 && new RegExp(WORD, 'i').test(fresh.map((row) => row.text).join(' ')), JSON.stringify(fresh))
  const liveOrder = inOrder(live)
  check(`live: the divider names Codex and ${target.name}`, live.some((row) => row.kind === 'divider' && row.text.includes('Codex') && row.text.includes(target.name)), said(live.filter((row) => row.kind === 'divider')) || 'no divider')
  check('live: first message, OK, divider, question, answer -- in that order', liveOrder.right, `${JSON.stringify(liveOrder)} || ${said(live)}`)
  await wide('live: the switched conversation (1920x1080)')

  handover = await drive.finish({ intro: `Wren on Codex (GPT-6-Luna, low, Ask) is given a word; the chip is switched to ${target.name}; Wren is asked for the word. Read live, then after the app is opened again.`, last: false })
} catch (error) {
  say(`first launch failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (handover !== undefined) {
  try {
    // The same profile, opened again: the conversation rebuilt from the record.
    drive = await launch({ profilePath: handover.profile, stepFrom: handover.step })
    await drive.ready()
    await drive.resize(1215, 800)
    await openWren()
    const reopened = JSON.parse(String(await drive.capture('opened again: the switched conversation from the record', () => drive.evaluate(THREAD))))
    const reopenedOrder = inOrder(reopened)
    check(`reopened: the divider names Codex and ${target.name}`, reopened.some((row) => row.kind === 'divider' && row.text.includes('Codex') && row.text.includes(target.name)), said(reopened.filter((row) => row.kind === 'divider')) || 'no divider')
    check('reopened: first message, OK, divider, question, answer -- in that order', reopenedOrder.right, `${JSON.stringify(reopenedOrder)} || ${said(reopened)}`)
    await wide('opened again (1920x1080)')
  } catch (error) {
    say(`second launch failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
say(failures === 0 ? '\nRUNTIME SWITCH PASSED' : `\nRUNTIME SWITCH: ${String(failures)} FAILED`)
await drive.finish({ intro: `Opened again on the same profile: the conversation switched from Codex to ${target.name}, rebuilt from the record.` })
