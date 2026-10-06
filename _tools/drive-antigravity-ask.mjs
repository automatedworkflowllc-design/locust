// What happens when Antigravity asks the person a question?
//
//   node _tools/drive-antigravity-ask.mjs
//
// Colin, 2026-09-07, with the two screenshots that started this: Antigravity
// called its own `ask_question` tool and its IDE drew a proper multiple-choice
// card ("Which test option would you like to select?", five options, Skip and
// Submit). Locust, on the same turn, drew a generic tool row reading
// "Prompting user with options  ask_question  still running" and then
// "Working ... 1m 10s". The header still said `running`.
//
// If that is what it looks like, the run cannot end: the model is blocked on
// input the app never collects. That is the silent-failure shape this whole
// product is pointed at, so it is worth measuring rather than reasoning about.
//
// Locust HAS a decision card, and it works -- but it is fed by a
// `<locust-ask>` block a model writes into its transcript, which exists
// because `codex exec` and `claude -p` have no side channel. Antigravity has a
// real one and does not use that block. Meanwhile the app-server service maps
// `item/tool/requestUserInput` to a `question` approval; Antigravity runs on a
// DIFFERENT service, which has no approval plumbing at all (0 references
// against app-server's 30).
//
// This drive answers three things:
//   1. does the run ever settle, or does it hang?
//   2. what does the tool row actually say?
//   3. what does the runtime send -- is there enough in it to build a card?
//
// The wait is capped: "still running after N seconds" IS the finding.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, startDrive, teammateFace } from './drive-lib.mjs'
import { homedir } from 'node:os'

const WAIT_SECONDS = 150

// NOT a scratch folder. Antigravity refuses any folder it has not opened as a
// project of its own -- "Antigravity has not opened <path>. Open that ..." --
// which Locust reports clearly and correctly, and which means a fresh
// mkdtemp workspace can never run here. This is the folder the smoke uses,
// and it is already registered. Override with argv[2].
// Forward slashes on purpose: Windows accepts them, and a path with no
// backslashes has no escapes for a shell heredoc to eat on the way in. That
// has now cost five separate edits in one session.
const workspace = process.argv[2] ?? join(homedir(), 'Documents', 'antigravtest').replace(/\\/g, '/')

const drive = await startDrive({
  name: 'antigravity-ask',
  port: 9356,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// Asks for the fork explicitly, the way Colin's own turn did, so the runtime
// reaches for its native question tool rather than guessing.
const ASK = `(async () => {
  const flat = (el) => el.innerText.split(String.fromCharCode(10)).map((t) => t.trim()).filter(Boolean).join(' ')
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Ask me to choose between exactly four different ways to organise this folder, using your multiple-choice question tool. Do not pick one yourself -- wait for my answer.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < ${String(WAIT_SECONDS)}; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? flat(header) : ''
    const decision = document.querySelector('.lc-decision')
    // A decision card appearing is the GOOD outcome and ends the wait early.
    if (decision) {
      return 'DECISION CARD DREW after ' + String(i) + 's: ' + flat(decision).slice(0, 300)
    }
    if (/completed|failed|cancelled/i.test(text)) {
      const fold = document.querySelector('.lc-activity')
      const red = document.querySelector('.lc-card.is-red')
      return 'settled after ' + String(i) + 's: ' + (text.match(/completed|failed|cancelled/i) ?? ['?'])[0]
        + ' || why: ' + (red ? flat(red).slice(0, 300) : '(no failure card)')
        + ' || trace: ' + (fold ? flat(fold).slice(0, 200) : 'no fold')
    }
  }
  const fold = document.querySelector('.lc-activity')
  const rows = [...document.querySelectorAll('.lc-filerow')].map(flat)
  return 'STILL RUNNING after ${String(WAIT_SECONDS)}s -- no decision card, nothing settled'
    + ' || header: ' + flat(document.querySelector('.lc-workroom__header') ?? document.body).slice(0, 120)
    + ' || trace: ' + (fold ? flat(fold).slice(0, 160) : 'no fold')
    + ' || rows: ' + (rows.length ? rows.join(' // ').slice(0, 300) : 'none')
})()`

try {
  await drive.capture('Antigravity / flash, Accept edits', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = ${teammateFace('Gem')}
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/antigravity/i', search: 'flash', row: '/flash/i' }))
  })

  await drive.capture('asked for a four-way choice', () => drive.evaluate(ASK))

  // The raw side: whatever the runtime actually sent for that tool call. If a
  // card is to be built later, this is what it would be built from.
  await drive.capture('what the runtime sent', async () => {
    const dir = join(drive.profile, 'mission-ledger')
    const names = await readdir(dir).catch(() => [])
    const text = (await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8').catch(() => '')))).join('\n')
    const asks = []
    for (const line of text.split('\n')) {
      if (!/ask_question|requestUserInput|user_input/i.test(line)) continue
      const record = JSON.parse(line)
      const found = JSON.stringify(record.event?.payload ?? record).slice(0, 700)
      asks.push(found)
    }
    return asks.length === 0 ? 'no ask_question record reached the ledger' : asks.slice(0, 2).join('   ~~~   ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Antigravity asking a question, and whether Locust can answer it.' })
}
