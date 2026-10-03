// A finished run survives the app closing, and the conversation carries on after (W9, 0.568).
//
//   node _tools/drive-a-run-survives-a-relaunch.mjs [--packaged <exe>] [--tag <name>]
//   LOCUST_SPEND=1 LOCUST_RUNTIME=codex LOCUST_MODEL=gpt-6-luna LOCUST_EFFORT=low node _tools/drive-a-run-survives-a-relaunch.mjs ...
//
// A matrix scenario (_tools/matrix.mjs). `drive-interrupted` kills a run in
// flight, on a dev build only; this is the everyday case on any build: a turn
// reads a file and answers, Locust is closed and opened again on the same
// profile, and the conversation must come back with its answer and the file
// read as a step -- then a follow-up must continue THAT conversation, not
// start another. Free OpenCode by default; any runtime with LOCUST_RUNTIME,
// which may spend that account (LOCUST_SPEND=1).

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { conversationRows, FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const RUNTIME = process.env.LOCUST_RUNTIME ?? 'opencode'
const MODEL = process.env.LOCUST_MODEL ?? (RUNTIME === 'opencode' ? FREE_ROUTE.model : undefined)
const EFFORT = process.env.LOCUST_EFFORT
const SPENDS = RUNTIME !== 'opencode'
const workspace = await scratchRepository('locust-drive-relaunch-ws-')
await writeFile(join(workspace, 'note.txt'), 'The kiln fires on Thursdays.\nGlaze orders close at noon.\n', 'utf8')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', roleTitle: 'Studio', createdAt: '2026-10-03T05:00:00.000Z', route: { runtime: RUNTIME, model: MODEL ?? 'account-default', ...(EFFORT === undefined ? {} : { effort: EFFORT }), mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
const base = {
  ...(packaged === undefined ? {} : { packaged }),
  name: `run-survives-relaunch-${RUNTIME}-${tag}`,
  port: 9888,
  workspace,
  ...(SPENDS ? { spends: true } : {})
}
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
let drive = await startDrive({ ...base, keep: true, outPath: join(recordRoot('a-run-survives-a-relaunch-2026-10-03'), `${RUNTIME}-${tag}`), seed })
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
  for (let second = 0; second < 300; second += 1) {
    await sleep(1000)
    const text = await thread()
    if (answeredAt === undefined && pattern.test(text)) answeredAt = second
    if (answeredAt !== undefined && !(await running())) return { answered: true, settled: true, text }
  }
  return { answered: answeredAt !== undefined, settled: false, text: await thread() }
}
/** The turn's step rows as drawn: a steps line or an activity card, with their words. */
const steps = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-thread .lc-steps__line, .lc-thread .lc-activity')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()))`)))
const rows = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify(${conversationRows()}.map((r) => ({ title: r.title, running: r.running })))`)))

try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Gem'))
  await send('Read note.txt and reply with its first line exactly, then the word DONE.')
  const first = await drive.capture('the turn, before closing', () => settle(/Thursdays/))
  check('it answered from the file and finished', first.answered && first.settled, first.text.slice(-300))
  const stepsBefore = await steps()
  check('the file read is drawn as a step', stepsBefore.length > 0, JSON.stringify(stepsBefore))
  const handoff = await drive.finish({ intro: `Gem on ${RUNTIME} / ${MODEL ?? 'default'}: one turn, then the app is closed.`, last: false })

  drive = await startDrive({ ...base, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step })
  await drive.ready()
  await drive.resize(1209, 770)
  const listed = await drive.capture('opened again: the sidebar', () => rows())
  check('the conversation is listed once, and not as running', listed.length === 1 && listed.every((row) => !row.running), JSON.stringify(listed))
  await drive.evaluate(`(async () => { ${conversationRows()}[0]?.click(); await new Promise((r) => setTimeout(r, 1500)) })()`)
  const reopened = await drive.capture('opened again: the conversation', () => thread())
  check('its answer came back', /Thursdays/.test(reopened), reopened.slice(-300))
  const stepsAfter = await steps()
  check('and its steps came back as they were drawn', stepsBefore.length > 0 && JSON.stringify(stepsAfter) === JSON.stringify(stepsBefore), `${JSON.stringify(stepsBefore)} -> ${JSON.stringify(stepsAfter)}`)
  check('nothing reads as failed or interrupted', !/interrupted|failed|could not run it/i.test(reopened), reopened.slice(-300))
  await send('What does the second line of that file say? Reply with it exactly.')
  const second = await drive.capture('a follow-up after the relaunch', () => settle(/What does the second line[\s\S]*noon/))
  check('the follow-up is answered', second.answered && second.settled, second.text.slice(-300))
  const after = await rows()
  check('and it continued the same conversation: still one row', after.length === 1, JSON.stringify(after))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Opened again on the same profile.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
