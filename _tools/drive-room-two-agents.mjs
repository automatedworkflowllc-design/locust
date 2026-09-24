// A room of two teammates on two different agents: ask once, do both answer?
//
//   LOCUST_SPEND=1 node _tools/drive-room-two-agents.mjs --packaged <exe> [--tag <name>]
//
// The beta handover: "Does a room with two different runtimes work? If it
// does, the video can film 'ask once, two agents answer.' As of 9/21, nobody
// had seen both answers arrive." The last proof on record is 2026-09-11
// (Cursor + OpenCode free); the 0.288 room drives were both on Claude. And
// the handover's update wants the screenshots on Claude and Codex, among
// them "a room of teammates on different models".
//
// Wren on Claude Code (Sonnet, low effort) and Pip on Codex (GPT-6-Luna, low),
// both read-only (Ask), relay off so each answers once. Each teammate's route
// is read off the composer BEFORE anything is sent, and the drive stops if
// either is not what was seeded. Two short turns; nothing written.
// The finished room is captured at 1920x1080 too, for the site.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `room-two-agents-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-room-two-ws-')
await writeFile(join(workspace, 'README.md'), '# Tide tables\n\nA small tool that prints the next high and low tide for a harbour, from a CSV of predictions.\n')
const now = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  name: `room-two-agents-${tag}`,
  port: 9509,
  workspace,
  outPath: OUT,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: { runtime: 'claude', model: 'sonnet', mode: 'ask', effort: 'low' } },
      { teammateId: 'tm_pip', name: 'Pip', hue: 'violet', role: 'Docs & QA', createdAt: now, route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'ask', effort: 'low' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    'rooms.json': {
      schemaVersion: 1,
      rooms: [{ roomId: 'rm_pair', name: 'pair', teammateIds: ['tm_wren', 'tm_pip'], createdAt: now, posts: [] }]
    }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const ROUTE = `(() => ([...document.querySelectorAll('button.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim())()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  // Each teammate's route, where a person reads it, before anything is sent.
  const routes = {}
  for (const name of ['Wren', 'Pip']) {
    await drive.evaluate(`(async () => { ${teammateFace(name)}?.click(); await new Promise((r) => setTimeout(r, 1500)) })()`)
    routes[name] = String(await drive.evaluate(ROUTE))
  }
  say(`routes: ${JSON.stringify(routes)}`)
  const right = /^Claude/i.test(routes.Wren) && /Sonnet/i.test(routes.Wren) && /^Codex/i.test(routes.Pip) && /GPT-6[- ]Luna/i.test(routes.Pip)
  check('Wren is on Claude Code / Sonnet and Pip on Codex / GPT-6-Luna, as seeded', right, JSON.stringify(routes))
  if (!right) throw new Error('refusing to post: a route is not what was seeded')

  const posted = await drive.capture('ask the room once', () => drive.evaluate(`(async () => {
    // The rooms are on the Rooms screen (the sidebar's own list shows only rooms with posts).
    ;[...document.querySelectorAll('button, a')].find((b) => (b.textContent ?? '').trim() === 'Rooms')?.click()
    await new Promise((r) => setTimeout(r, 1000))
    const row = [...document.querySelectorAll('.lc-roomcard, .lc-roomrow')].find((r) => /pair/.test(r.innerText))
    if (row === undefined) return 'no room row'
    row.click()
    await new Promise((r) => setTimeout(r, 900))
    const box = document.querySelector('.lc-roomcompose__box')
    if (box === null) return 'no room composer'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Read README.md and tell me in one sentence what this project does. Change nothing.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 250))
    document.querySelector('.lc-roomcompose').requestSubmit()
    return 'posted'
  })()`))
  check('the post went to the room', String(posted) === 'posted', String(posted))

  // Both answers, however long the slower takes (four minutes at most).
  const read = `(() => JSON.stringify([...document.querySelectorAll('.lc-roomanswer')].map((card) => ({
    who: card.querySelector('.lc-face')?.getAttribute('aria-label') ?? (card.querySelector('[class*="name"]')?.textContent ?? '').trim(),
    text: (card.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300)
  }))))()`
  let answers = []
  for (let waited = 0; waited < 240_000; waited += 2000) {
    await sleep(2000)
    answers = JSON.parse(String(await drive.evaluate(read)))
    const done = answers.length >= 2 && answers.every((answer) => /tide/i.test(answer.text))
    if (done) break
  }
  await sleep(1500)
  await drive.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const final = await drive.capture('both answers in the room (1920x1080)', () => drive.evaluate(read))
  await drive.send('Emulation.clearDeviceMetricsOverride', {})
  answers = JSON.parse(String(final))
  say(`answers: ${JSON.stringify(answers)}`)
  const wren = answers.find((answer) => /Wren/.test(answer.who) || /Wren/.test(answer.text))
  const pip = answers.find((answer) => /Pip/.test(answer.who) || /Pip/.test(answer.text))
  check('Wren (Claude) answered, about the tide tool', wren !== undefined && /tide/i.test(wren.text), JSON.stringify(wren))
  check('Pip (Codex) answered, about the tide tool', pip !== undefined && /tide/i.test(pip.text), JSON.stringify(pip))
  say(failures === 0 ? '\nROOM TWO AGENTS PASSED' : `\nROOM TWO AGENTS: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'A room of two: Wren on Claude Code (Sonnet, low) and Pip on Codex (GPT-6-Luna, low), read-only, relay off; asked once. Two short turns.' })
}
