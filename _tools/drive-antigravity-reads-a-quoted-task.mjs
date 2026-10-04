// An Antigravity run that reads a file quoting a background task still ends
// when it answers (0.537).
//
//   LOCUST_SPEND=1 node _tools/drive-antigravity-reads-a-quoted-task.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: "on antigravity it says the agent is still working and
// didnt show antigravitys last message". His run read its subagents'
// transcripts, which quote "Tool is running as a background task with task
// id: ..."; each read was counted as background work that never ended. Here
// Gem (Antigravity Flash, one short turn on the person's account) reads a
// file holding that line and answers in one sentence. The run must finish on
// that answer. In the folder Antigravity already has open (it refuses any
// other); the file is removed afterwards.

import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const WORKSPACE = 'C:/Users/<home>/Documents/antigravtest'
const FILE = join(WORKSPACE, 'quoted-task.txt')
await writeFile(FILE, [
  'Notes copied from another agent\'s log:',
  'Tool is running as a background task with task id: 11111111-2222-3333-4444-555555555555/task-7',
  'Task Description: npm test',
  'The tests passed later that day.',
  ''
].join('\n'), 'utf8')

const drive = await startDrive({
  name: `antigravity-quoted-task-${tag}`,
  port: 9859,
  workspace: WORKSPACE,
  spends: true,
  outPath: join(recordRoot('antigravity-reads-a-quoted-task-2026-10-02'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', createdAt: '2026-10-02T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const PROMPT = 'Open quoted-task.txt with your file viewing tool and reply with one sentence saying what it is about, ending with the word FINISHED. Do not run any commands and change no files.'
const header = () => drive.evaluate(`document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(`(async () => {
    const gem = [...document.querySelectorAll('button')].find((b) => /Gem/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    gem?.click()
    await new Promise((r) => setTimeout(r, 800))
    return 1
  })()`)
  say(String(await drive.evaluate(pickRouteScript({ group: '/antigravity/i', search: 'flash', row: '/flash/i' }))))
  const route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  if (!/antigravity/i.test(route) || !/flash/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not Antigravity's Flash`)
  say(`route: ${route}`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
    return 'sent'
  })()`)
  // The answer lands in the thread; then the run must settle on its own.
  let answeredAt
  let settledAt
  for (let second = 0; second < 300 && settledAt === undefined; second += 1) {
    await sleep(1000)
    const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`))
    if (answeredAt === undefined && /FINISHED/.test(thread.replace(PROMPT, ''))) answeredAt = second
    // Settled: no Stop button, and the header no longer says running.
    if (answeredAt !== undefined && !/running/i.test(String(await header())) && !document_running(await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`))) settledAt = second
  }
  await drive.capture('after the answer', () => drive.evaluate('1'))
  const said = String(await header())
  check('Antigravity answered (FINISHED is in the thread)', answeredAt !== undefined, `answered at ${String(answeredAt)}s`)
  check('the run settled on its own', settledAt !== undefined && !/running/i.test(said), `${said.slice(0, 160)} (settled at ${String(settledAt)}s)`)
  check('it settled soon after the answer, not at an idle limit', answeredAt !== undefined && settledAt !== undefined && settledAt - answeredAt <= 30, `answered ${String(answeredAt)}s, settled ${String(settledAt)}s`)
  const stop = await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`)
  check('no Stop button is left on screen', stop === false)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Gem on Antigravity Flash reads a file quoting a background task.`, extra: `Checks failed: ${String(failures)}` })
  await rm(FILE, { force: true })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

function document_running(running) {
  return running === true
}
