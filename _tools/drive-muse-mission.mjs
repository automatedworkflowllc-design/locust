// Send a real Muse Code mission from the packaged app, and see where it dies.
//
//   node _tools/drive-muse-mission.mjs
//
// THE POINT IS THE PLACE OF DEATH, not whether it succeeds. On 0.247.0 a
// Muse mission stopped at "the mission ledger could not be written" -- before
// the runtime was ever launched, because the ledger's own list of recordable
// runtimes had no line for Muse. Colin hit it on his first run.
//
// This machine is not signed in to Muse, so the run is EXPECTED to fail --
// with `missing meta credentials`, which is Muse's own refusal, reached only
// after the mission was written down and the process was started. That is the
// whole proof: the ledger wrote, the runtime ran, the failure is the
// runtime's. A run that dies at the ledger again shows up here as the ledger
// card, by name.
//
// It spends nothing: without credentials Muse never reaches a model.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

/*
 * PROVE IT CANNOT SPEND, rather than declare that it does not.
 *
 * `startDrive` moves any non-free route to the free one unless a drive says
 * `spends: true`, which is the right guard and is left alone -- this script
 * switches to Muse AFTER that guard has run. What stands in for the guard is
 * this: a Muse run reaches a model only with credentials, and if either of
 * these exists on this machine the run could bill somebody, so it refuses.
 */
const AUTH_FILE = join(homedir(), '.config', 'muse', 'auth.json')
if (existsSync(AUTH_FILE)) {
  say(`refusing: ${AUTH_FILE} exists, so a Muse run here could reach a model and bill for it.`)
  say('This drive is only safe on a machine with no Muse credentials.')
  process.exit(1)
}
if ((process.env.META_API_KEY ?? '').length > 0) {
  say('refusing: META_API_KEY is set, so a Muse run here could reach a model and bill for it.')
  process.exit(1)
}
say('no Muse credentials on this machine: the run will stop at Muse rather than reach a model.')

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE} -- run node _tools/ship.mjs first`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-muse-mission-ws-')
const drive = await startDrive({
  name: 'muse-mission',
  port: 9318,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'ask' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const sendOne = `(async () => {
  const box = document.querySelector('textarea')
  if (!box) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, 'Say the word PING and nothing else.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  const send = [...document.querySelectorAll('button')].find(b => /start mission|send/i.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.getAttribute('title') ?? '')))
  if (!send) return 'no send button; titles seen: ' + [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? '').filter(Boolean).join(' / ').slice(0, 400)
  send.click()
  return 'sent, on route: ' + (document.querySelector('.lc-control')?.innerText.replace(/\\s+/g, ' ').trim() ?? '?')
})()`

/** What the thread ended up saying, and whether the ledger is what stopped it. */
const verdict = `(() => {
  const text = document.body.innerText.replace(/\\s+/g, ' ')
  const ledgerCard = /mission ledger could not be written/i.test(text)
  const credentials = /missing meta credentials|muse login|META_API_KEY/i.test(text)
  const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
  const card = [...document.querySelectorAll('.lc-stopcard, .lc-failure, [class*=stop], [class*=fail]')]
    .map(n => n.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean)[0] ?? ''
  return 'LEDGER STOPPED IT: ' + (ledgerCard ? 'YES -- the bug is back' : 'no')
    + ' || Muse asked to sign in: ' + (credentials ? 'yes' : 'no')
    + ' || header: ' + header.slice(0, 120)
    + ' || card: ' + card.slice(0, 300)
})()`

try {
  await drive.capture('launch', () => drive.ready())
  // AFTER ready(), whose free-route guard has now run and been satisfied.
  await drive.capture('put the composer on Muse Code', () => drive.evaluate(pickRouteScript({ group: '/muse/i', search: '', row: '/account default/i' })))
  await drive.capture('send one message on Muse Code', () => drive.evaluate(sendOne))
  await drive.capture('wait for the run to settle', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    return 'waited 20s'
  })
  await drive.capture('where did it die', () => drive.evaluate(verdict))
} finally {
  await drive.finish({ intro: 'A real Muse Code mission on the packaged 0.248.0 build. It is expected to FAIL -- this machine is not signed in to Muse -- and the point is that it fails at the runtime rather than at the mission ledger.' })
  say(`kept: ${drive.out}`)
}
