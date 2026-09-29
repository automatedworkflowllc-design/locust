// The one card nobody has ever seen.
//
//   node _tools/drive-ledger-failure.mjs
//
// The durable ledger is the product's central claim, and the moment that claim
// breaks is the moment the app has to be at its most honest. There is a card
// for it. It is built from a spec, its copy is unit-tested, and NO HUMAN HAS
// EVER LOOKED AT IT -- four kills at four points during live runs produced
// zero damaged ledgers, and a ledger write has never failed on this machine.
//
// The design pass asked for a dev-only trigger behind a scenario switch, on the
// grounds that "a state no human has seen is a state that will be wrong on the
// day it appears". This is better than a trigger: nothing is simulated. The
// profile's `mission-ledger` is created as a FILE where the app needs a
// DIRECTORY, so `mkdir(rootDirectory, { recursive: true })` fails for real, on
// a real syscall, and every ledger write fails after it. Same technique as
// `stores-fail-closed.test.ts`, which found a false pass on its first run.
//
// What this asks:
//   does the run stop, rather than carry on unrecorded
//   does the card appear, and does it say STOPPED rather than held or paused
//   does it name what is safe and what is at risk
//   does it show where the ledger lives
//
// Free OpenCode model, so it costs nothing.

import { readFile, writeFile, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

const workspace = await scratchRepository('locust-ledgerfail-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-ledgerfail-'))

/*
 * A plain file where the directory belongs.
 *
 * Written BEFORE the app starts and before `startDrive` seeds anything, so the
 * very first ledger call fails. `drive-lib` itself tries to mkdir this path
 * when it seeds teammates and swallows the failure, which is what we want: the
 * teammate seed lives in `teammates.json` and is unaffected, so the app comes
 * up with a teammate and cannot write a mission.
 */
await writeFile(join(profile, 'mission-ledger'), 'not a directory', 'utf8')

const drive = await startDrive({ name: 'ledger-failure', port: 9411, workspace, profilePath: profile, seed })

try {
  await drive.capture('the ledger cannot be written before anything starts', async () => {
    await drive.ready()
    // The premise, asserted rather than assumed: if this is a directory the
    // drive is testing nothing and must say so instead of passing.
    const blocking = await stat(join(profile, 'mission-ledger'))
    return blocking.isFile()
      ? 'mission-ledger is a FILE where the app needs a directory -- every ledger write will fail'
      : 'NOT A TEST: mission-ledger is a directory, so nothing is broken'
  })

  await drive.capture('send a message to a teammate whose receipts cannot be written', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
    return drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Mission instruction"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, 'Say the single word READY and nothing else.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      box.focus()
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise(r => setTimeout(r, 6000))
      return 'sent'
    })()`)
  })

  await drive.capture('what the app says about a record it could not write', async () => {
    return drive.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 4000))
      /*
       * The card's own text, by its own classes -- not a word search over the
       * body. Reading the whole page for "stopped" has already produced two
       * false findings in this repo, once matching the Missions filter chips.
       *
       * No backticks in this comment: it sits inside a template literal.
       */
      const card = [...document.querySelectorAll('.lc-card.is-terminal')]
        .find(el => /ledger/i.test(el.innerText ?? ''))
      if (card === undefined) {
        return JSON.stringify({ cardFound: false, body: (document.body.innerText ?? '').slice(0, 400) })
      }
      const text = (card.innerText ?? '').replace(/\\s+/g, ' ')
      return JSON.stringify({
        cardFound: true,
        title: (card.querySelector('.lc-card__head')?.innerText ?? '').replace(/\\s+/g, ' '),
        saysStopped: /stopped/i.test(text),
        saysHeldOrPaused: /\\bheld\\b|\\bpaused\\b/i.test(text),
        namesSafe: /safe/i.test(text),
        namesAtRisk: /at risk/i.test(text),
        showsLedgerPath: card.querySelector('.lc-ledgerfail__path') !== null,
        inventsACheckpoint: /ck_[0-9]+/i.test(text),
        text: text.slice(0, 700)
      })
    })()`)
  })

  await drive.capture('and the Missions screen does not claim the ledger is verified', async () => {
    return drive.evaluate(`(async () => {
      document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
      await new Promise(r => setTimeout(r, 1500))
      const meta = (document.querySelector('.lc-screen__meta')?.textContent ?? '').trim()
      return JSON.stringify({ meta, claimsVerified: /ledger (verified|readable)/i.test(meta) })
    })()`)
  })

  await drive.capture('the app did not quietly repair what was blocking it', async () => {
    /*
     * Read BEFORE `finish`, which removes the whole profile when `keep` is not
     * set. A first version read it afterwards and reported "<gone>" every
     * time -- which looks exactly like the app having deleted the file to get
     * its directory back, and was entirely the harness deleting its own
     * profile.
     */
    const left = await readFile(join(profile, 'mission-ledger'), 'utf8').catch(() => undefined)
    return left === undefined
      ? 'FAIL: the blocking file is gone -- something replaced it rather than failing'
      : `the blocking file is untouched: ${JSON.stringify(left)}`
  })
} finally {
  await drive.finish({
    intro:
      'The mission ledger cannot be written -- its directory is a plain file -- so every receipt fails on a real syscall. This is the first time the failure card has been looked at.'
  })
}

say('done')
