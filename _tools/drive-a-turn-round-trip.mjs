// Antigravity through its CLI: a turn, its tool, its answer, its end, and a follow-up (0.540).
//
//   LOCUST_SPEND=1 [LOCUST_RUNTIME=codex LOCUST_MODEL=gpt-6-luna LOCUST_EFFORT=low] node _tools/drive-a-turn-round-trip.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: Gemini CLI refused his AI Pro sign-in ("no longer
// supported ... migrate to the Antigravity suite"), and Antigravity's app
// route had left runs "still working" with their answer unshown. With `agy`
// installed, Antigravity runs through it. Here Gem, on Gemini 3.8 Flash
// (Low), in ASK, in an ordinary scratch folder (the app route could only use
// a folder Antigravity had open), reads a file and answers; then a follow-up
// is answered from the same conversation. Two short turns on the person's
// own Antigravity account.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// Any runtime (0.540, Colin: "you might as well test the other main ones"): a
// cheap model each. Antigravity's own checks run only on Antigravity.
const RUNTIME = process.env.LOCUST_RUNTIME ?? 'antigravity'
const MODEL = process.env.LOCUST_MODEL ?? (RUNTIME === 'antigravity' ? 'gemini-3.8-flash' : undefined)
const EFFORT = process.env.LOCUST_EFFORT ?? (RUNTIME === 'antigravity' ? 'low' : undefined)
const SPENDS = RUNTIME !== 'opencode'
const workspace = await scratchRepository('locust-drive-agy-ws-')
await writeFile(join(workspace, 'note.txt'), 'The kiln fires on Thursdays.\nSecond line.\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-turn-round-trip-${RUNTIME}-${tag}`,
  port: 9861,
  workspace,
  ...(SPENDS ? { spends: true } : {}),
  outPath: join(recordRoot('antigravity-cli-2026-10-02'), `${RUNTIME}-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', roleTitle: 'Research', createdAt: '2026-10-02T05:00:00.000Z', route: { runtime: RUNTIME, model: MODEL ?? 'account-default', ...(EFFORT === undefined ? {} : { effort: EFFORT }), mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'no send'
})()`)
const thread = async () => String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
const running = async () => Boolean(await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`))
/** Waits for `pattern` in the thread, then for the run to end on its own. */
const settle = async (pattern) => {
  let answeredAt
  for (let second = 0; second < 240; second += 1) {
    await sleep(1000)
    const text = await thread()
    if (answeredAt === undefined && pattern.test(text)) answeredAt = second
    if (answeredAt !== undefined && !(await running())) return { answeredAt, settledAt: second, text }
  }
  return { answeredAt, settledAt: undefined, text: await thread() }
}
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Gem'))
  // The route is drawn once discovery has answered, which takes a few seconds on a cold start.
  let route = ''
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
    if (route.length > 0 && !/No AI agent/i.test(route)) break
  }
  say(`route: ${route}`)
  const runtimeWord = { antigravity: /antigravity/i, codex: /codex/i, claude: /claude/i, cursor: /cursor/i, opencode: /opencode/i }[RUNTIME] ?? new RegExp(RUNTIME, 'i')
  if (!runtimeWord.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not ${RUNTIME}`)
  if (RUNTIME === 'antigravity') check('the box names the model once, with its effort as the effort and not as a model', /Gemini 3\.8 Flash/.test(route) && !/Flash Low/.test(route), route)
  // The model list arrives after the window does; the chip is drawn once it has.
  const effort = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      const chip = document.querySelector('button[aria-label="Reasoning effort"]') ?? [...document.querySelectorAll('.lc-control.is-static')].find((el) => /Fixed/.test(el.innerText))
      if (chip) return chip.innerText.trim()
      await new Promise((r) => setTimeout(r, 250))
    }
    return 'no effort chip in 20s'
  })()`))
  if (RUNTIME === 'antigravity') check(`the effort chip offers ${EFFORT}, not Fixed`, effort.toLowerCase() === String(EFFORT), effort)
  await send('Read note.txt and reply with its first line exactly, then the word DONE.')
  const first = await drive.capture('the first turn', () => settle(/Thursdays/))
  check('it answered with the file’s first line', first.answeredAt !== undefined, first.text.slice(-400))
  check('and the run ended on its own, soon after', first.settledAt !== undefined && first.settledAt - first.answeredAt <= 20, `answered ${String(first.answeredAt)}s, settled ${String(first.settledAt)}s`)
  check('its file read is a step in the thread', /view_file|note\.txt/i.test(first.text), first.text.slice(0, 600))
  check('nothing failed', !/could not run it|ended without a record|failed/i.test(first.text), first.text.slice(-400))
  await send('Which file did you just read? Reply with only its name.')
  const second = await drive.capture('the follow-up', () => settle(/Which file did you just read\?[\s\S]*note\.txt/))
  check('the follow-up is answered from the same conversation', second.answeredAt !== undefined && second.settledAt !== undefined, second.text.slice(-300))
  // Copy, as Claude Code's (0.545): one per turn, hidden until the reply is hovered. Never pressed here (the clipboard is the person's).
  const copies = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('button[aria-label="Copy this reply"]')].map((b) => getComputedStyle(b).opacity))`)))
  const box = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => { const r = document.querySelector('.lc-agentline__body')?.getBoundingClientRect(); return r ? { x: r.left + 20, y: r.top + 8 } : null })())`)))
  if (box !== null) await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await sleep(400)
  const shownOnHover = String(await drive.evaluate(`getComputedStyle(document.querySelector('button[aria-label="Copy this reply"]')).opacity`))
  check('each turn has one Copy, hidden at rest and shown on hover', copies.length === 2 && copies.every((o) => o === '0') && shownOnHover === '1', `${JSON.stringify(copies)} then ${shownOnHover}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Gem on ${RUNTIME} / ${MODEL ?? 'default'}${EFFORT === undefined ? '' : ` (${EFFORT})`}, Ask; two turns.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
