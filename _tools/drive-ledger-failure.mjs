// What the app says when it cannot write its own receipts.
//
//   node _tools/drive-ledger-failure.mjs
//
// The durable local ledger is the product's central claim: every mission is
// recorded and the record can be checked afterwards. The one moment that claim
// breaks was the one moment nothing was designed -- the design pass named it as
// a missing state, and what actually appeared said, in consecutive sentences,
// "Mission held" and "The run was stopped".
//
// HOW THE FAILURE IS CAUSED, and why this way.
//
// Not by filling the disk, and not by chmod: on Windows a directory ACL is not
// what stops a write here, and a test that needs an elevated shell is a test
// nobody runs. Instead the mission ledger's directory is replaced by a FILE of
// the same name before launch. Every append then fails at the filesystem, for a
// real reason, on the real path, with no product code aware it is a drill.
//
// That makes this a drive of the FIRST write rather than a mid-run one, which
// is the honest limit of it: it proves the card, the wording and the folder
// button, and it does NOT prove what happens when the ledger dies at
// checkpoint 14 of a live run. That case wants the host to hold the process,
// which it does not do today -- it stops it -- and stopping is what the card
// now says.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import './scratch-root.mjs'
import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const profile = join(homedir(), 'Documents', 'locust-scratch', `locust-ledgerfail-${String(Date.now())}`)
await mkdir(profile, { recursive: true })
// The ledger wants `<profile>/mission-ledger` to be a DIRECTORY. It is now a
// file, so `mkdir` and every append inside it fail for a real reason.
await rm(join(profile, 'mission-ledger'), { recursive: true, force: true }).catch(() => undefined)
await writeFile(join(profile, 'mission-ledger'), 'not a directory\n', 'utf8')
say(`ledger path blocked: ${join(profile, 'mission-ledger')}`)

const workspace = await scratchRepository('locust-drive-ledgerfail-ws-')
const drive = await startDrive({
  name: 'ledger-failure',
  port: 9364,
  workspace,
  profilePath: profile,
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch, with the ledger path blocked', () => drive.ready())

  await drive.capture('pick a route and send one line', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok-4.6', row: '/grok-4.6/i' }))
    return drive.evaluate(sendAndWaitScript('Reply with exactly one word: ready.', { waitSeconds: 240 }))
  })

  await drive.capture('what the card says', () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 1000))
    const card = [...document.querySelectorAll('.lc-card.is-red')].pop()
    if (!card) return 'NO RED CARD AT ALL -- the failure was silent'
    const title = card.querySelector('.lc-card__head')?.innerText.trim() ?? ''
    const rows = [...card.querySelectorAll('.lc-ledgerfail__label')].map(n => n.innerText.trim())
    const button = [...card.querySelectorAll('button')].map(b => b.innerText.trim())
    return 'title: ' + title + ' || rows: [' + rows.join(', ') + '] || buttons: [' + button.join(', ') + ']'
  })()`))

  // The claim the old card broke. It must not say a run was held when the run
  // was stopped -- that is the exact looseness this state exists to fix.
  await drive.capture('does it still claim the run was held', () => drive.evaluate(`(() => {
    const card = [...document.querySelectorAll('.lc-card.is-red')].pop()
    const text = card ? card.innerText : ''
    const held = /\\bheld\\b|\\bpaused\\b/i.test(text)
    const stopped = /stopped/i.test(text)
    return (held ? 'STILL SAYS HELD -- ' : 'does not claim held -- ') + (stopped ? 'and says stopped' : 'and does NOT say stopped either')
  })()`))

  await drive.capture('the folder button answers', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-card.is-red')].pop()
    const button = card ? [...card.querySelectorAll('button')].find(b => /ledger folder/i.test(b.innerText)) : undefined
    if (!button) return 'no folder button on the card'
    button.click()
    await new Promise(r => setTimeout(r, 1000))
    return 'pressed the folder button; no refusal shown'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The mission ledger directory replaced by a file, so every append fails for a real reason on the real path. What the app then says.',
    extra: [
      '## The honest limit of this drive',
      '',
      'This fails the FIRST write, not a write at checkpoint 14 of a live run.',
      'It proves the card, its wording and its folder button. It does not prove',
      'a mid-run failure, because the host stops the run rather than holding it',
      '-- which is what the card now says, and what the design pass would still',
      'like changed.',
      ''
    ].join('\n')
  })
  await rm(join(profile, 'mission-ledger'), { force: true }).catch(() => undefined)
}
