// A Claude turn keeps going when Locust closes (W10, 0.683).
//
//   LOCUST_SPEND=1 node _tools/drive-a-background-turn-outlives-locust.mjs --workspace <a folder Claude Code trusts> [--packaged <exe>] [--tag <name>]
//
// `claude --bg` refuses a folder Claude Code has not been told to trust, and Locust never answers that question,
// so this runs in a folder the person has trusted in Claude Code once (a scratch folder kept for it).
// Ash, on Claude Haiku in Ask, answers one turn in Locust. Then, with Background picked in the chat type menu:
//   1. a turn that finishes while Locust watches: the panel follows it to done, and the conversation shows it
//      under "In the background", with its answer;
//   2. a turn sent, then Locust quit at once: Claude Code finishes it alone; Locust, opened again on the same
//      profile, brings it into the conversation without being asked.
// Spends three Haiku turns.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = arg('--workspace')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
if (workspace === undefined) { say('--workspace <a folder Claude Code trusts> is required'); process.exit(1) }
const OUT = join(recordRoot('a-background-turn-outlives-locust-2026-10-06'), tag)
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
// Through a shell: on Windows `claude` is often a script shim, which execFile alone cannot start.
const agents = () => new Promise((resolve) => execFile('claude', ['agents', '--json', '--all'], { windowsHide: true, shell: true }, (_error, stdout) => {
  try { resolve(JSON.parse(String(stdout))) } catch { resolve([]) }
}))
const pickBackground = `(async () => {
  document.querySelector('button[aria-label^="Chat mode"]')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const item = [...document.querySelectorAll('.lc-menu[aria-label="Direct or compare"] .lc-menu__item')].find((b) => b.querySelector('.lc-menu__name')?.innerText.trim() === 'Background')
  if (!item) return 'no Background choice'
  item.click()
  await new Promise((r) => setTimeout(r, 500))
  return document.querySelector('button[aria-label^="Chat mode"]')?.getAttribute('aria-label') ?? ''
})()`
const send = (text) => `(async () => {
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
})()`
const panel = `JSON.stringify([...document.querySelectorAll('aside[aria-label="In the background"] .lc-cloudtask')].map((card) => ({ prompt: card.querySelector('.lc-cloudtask__prompt')?.innerText ?? '', state: card.querySelector('.lc-cloudtask__state')?.innerText ?? '' })))`
const thread = `document.querySelector('.lc-thread')?.innerText ?? ''`
// What the record holds: each turn's id, its words and how it started.
const historyProbe = `window.desktop.getMissionHistory().then((answer) => JSON.stringify((answer.ok ? (answer.data.missions ?? []) : []).map((m) => [String(m.missionId).slice(8, 16), String(m.prompt ?? '').slice(0, 30), m.startedBy?.kind ?? null])))`
const ids = []
// Claude Code renames a session once it starts ("create hello.txt file"), so a run is found by the id Locust kept.
const keptRuns = async (profile) => JSON.parse(await readFile(join(profile, 'claude-background.json'), 'utf8').catch(() => '[]'))

let drive = await startDrive({ name: `background-turn-${tag}`, port: 9821, workspace, outPath: OUT, keep: true, seed, spends: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
try {
  await drive.ready()
  await drive.resize(1300, 860)
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  await drive.capture('Ash answers in Locust', () => drive.evaluate(sendAndWaitScript('Reply with exactly the word one.', { waitSeconds: 180 })))
  const chosen = String(await drive.evaluate(pickBackground))
  check('Background is in the chat type menu for a Claude teammate', /Background/.test(chosen), chosen)
  say(`  ${String(await drive.evaluate(send('Reply with exactly the word two.')))}`)
  let cards = []
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000)
    cards = JSON.parse(String(await drive.evaluate(panel)))
    if (cards[0] !== undefined && /in the conversation/.test(cards[0].state)) break
  }
  await drive.capture('The panel: done, and back in the conversation', () => drive.evaluate(panel))
  check('the panel followed it to done, and says its answer is in the conversation', /Done\. Its answer is in the conversation/.test(cards[0]?.state ?? ''), JSON.stringify(cards))
  let after = ''
  for (let i = 0; i < 20; i += 1) {
    after = String(await drive.evaluate(thread))
    if (/in the background/i.test(after) && /\btwo\b/i.test(after)) break
    await sleep(750)
  }
  await drive.capture('The conversation: In the background, two', () => drive.evaluate(thread))
  say(`  history after two: ${String(await drive.evaluate(historyProbe))}`)
  check('the conversation shows it under "In the background", with its answer', /in the background/i.test(after) && /\btwo\b/i.test(after), after.slice(-300))
  const header = String(await drive.evaluate(`document.querySelector('.lc-workroom__header')?.innerText ?? ''`))
  check("it is still Ash's conversation", /^Ash\b/.test(header), header.slice(0, 120))
  for (const run of await keptRuns(profilePath)) ids.push(run.id)
  say(`  profile ${profilePath}; kept after two: ${JSON.stringify(await keptRuns(profilePath))}`)
  // The point of it: send, and close Locust at once.
  say(`  ${String(await drive.evaluate(pickBackground))}`)
  say(`  third send: ${String(await drive.evaluate(send('Reply with exactly the word three.')))}`)
  // Until Locust has it on its list -- then closed at once.
  for (let i = 0; i < 30 && !(await keptRuns(profilePath)).some((run) => /word three/.test(run.prompt)); i += 1) await sleep(500)
  say(`  kept runs before closing: ${JSON.stringify((await keptRuns(profilePath)).map((run) => [run.id, run.prompt, run.state]))}`)
  say(`  panel: ${String(await drive.evaluate(panel))}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, Ask; two turns in the background, Locust closed after the second.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

// Claude Code finishes alone.
const threeId = (await keptRuns(profilePath)).find((run) => /word three/.test(run.prompt))?.id
let three
for (let i = 0; i < 60 && threeId !== undefined && three?.state !== 'done'; i += 1) {
  await sleep(3000)
  three = (await agents()).find((agent) => agent.id === threeId)
}
check('with Locust closed, Claude Code finished the turn on its own', three?.state === 'done', JSON.stringify(three ?? {}))
if (threeId !== undefined && !ids.includes(threeId)) ids.push(threeId)

drive = await startDrive({ name: `background-turn-${tag}-again`, port: 9821, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 4, spends: true, keep: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1300, 860)
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  let seen = ''
  for (let i = 0; i < 40; i += 1) {
    await sleep(1500)
    seen = String(await drive.evaluate(thread))
    if (/\bthree\b/i.test(seen)) break
  }
  await drive.capture('Opened again: the turn is in the conversation', () => drive.evaluate(thread))
  check('opened again, Locust brought the finished turn into the conversation by itself', /\bthree\b/i.test(seen), seen.slice(-300))
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar .lc-conv, .lc-sidebar [data-mission-id]')][0]?.click()`)
  await sleep(2000)
  say(`  after clicking the row again: ${String(await drive.evaluate(thread)).replace(/\s+/g, ' ').slice(-200)}`)
  say(`  owners after reopening: ${String(await drive.evaluate("window.desktop.listTeammates().then((r) => JSON.stringify(r.ok ? Object.entries(r.data.missionOwners).map(([m, t]) => [m.slice(8, 16), t]) : r))"))}`)
  say(`  kept after reopening: ${JSON.stringify(await keptRuns(profilePath))}`)
  say(`  history after reopening: ${String(await drive.evaluate(historyProbe))}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Opened again on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
// Claude Code's own list, left as it was found.
for (const id of ids) await new Promise((resolve) => execFile('claude', ['rm', id], { windowsHide: true, shell: true }, () => resolve(undefined)))
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
