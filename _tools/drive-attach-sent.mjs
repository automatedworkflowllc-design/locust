// What a person sees in the transcript AFTER sending with a file attached.
//
//   node _tools/drive-attach-sent.mjs
//
// `drive-attach.mjs` covers the control and the host's refusals, but it never
// sends -- so nothing has ever looked at the message bubble that comes out the
// other side. `withAttachments` puts "Read this file in the workspace before
// you answer: - <path>" ABOVE what was typed, and that string is what
// `onStart` receives. If the transcript renders the prompt verbatim, the
// person reads the host's machinery in their own words, which is not what
// they said.
//
// The OS file dialog cannot be driven, so `attachFiles` is stubbed to return
// the path the dialog would have returned. Everything after that point -- the
// chip, the prompt built from it, the bubble -- is the real code.
//
// Runs on a free OpenCode model. Nothing is spent.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-attachsent-ws-')
// Into the WORKSPACE. `startDrive`'s `files` writes into the profile, and a
// first run of this drive attached a path to a file that was not there -- the
// teammate then searched the disk for it and asked where it lived, which was
// the right behaviour against a wrong fixture.
await writeFile(join(workspace, 'NOTES.md'), '# Notes' + '\n\nThe passphrase is ORCHID-4417.\n', 'utf8')
const drive = await startDrive({
  name: 'attach-sent',
  port: 9387,
  workspace,
  // The dialog cannot be driven and the bridge cannot be stubbed (contextBridge
  // exposes it non-configurable), so the host is told what the dialog would
  // have returned. The containment check still runs on it.
  // Absolute, because that is what the dialog returns and what the
  // containment check resolves.
  env: { LOCUST_ATTACH_PATHS: workspace + String.fromCharCode(47) + 'NOTES.md' },
  files: {
    'NOTES.md': '# Notes\n\nThe passphrase is ORCHID-4417.\n'
  },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a free model', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('attach NOTES.md, as the picker would', () => drive.evaluate(`(async () => {
    const plus = document.querySelector('button[data-satellite="attach"]')
    if (!plus) return 'no attach control'
    plus.click()
    await new Promise(r => setTimeout(r, 900))
    const tiles = [...document.querySelectorAll('.lc-attached__tile')].map(t => t.textContent?.trim())
    return tiles.length === 0 ? 'NO TILE after attaching' : 'tiles: ' + JSON.stringify(tiles)
  })()`))

  await drive.capture('type a question and send it', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'What is the passphrase?')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 2500))
    return 'sent'
  })()`))

  await drive.capture('THE QUESTION: what the person reads back in their own bubble', () => drive.evaluate(`(() => {
    const mine = [...document.querySelectorAll('.lc-bubble')]
      .map(n => n.textContent?.replace(/\\s+/g, ' ').trim())
      .filter(t => t && t.includes('passphrase'))
    return JSON.stringify(mine.slice(0, 3), null, 1)
  })()`))

  await drive.capture('did the file reach the model', () => drive.evaluate(`(async () => {
    // The mission header is what says whether the turn is over; the stop
    // button is on the composer and outlives the run's own state.
    for (let i = 0; i < 150; i += 1) {
      await new Promise(r => setTimeout(r, 2000))
      const head = document.querySelector('.lc-workroom__head, header')?.textContent ?? ''
      if (!/running|starting/i.test(head)) break
    }
    const text = document.body.innerText
    return text.includes('ORCHID-4417')
      ? 'the file was read: ORCHID-4417 came back'
      : 'NO PASSPHRASE -- ' + (document.querySelector('.lc-workroom__head, header')?.textContent?.replace(/\\s+/g, ' ').trim() ?? 'no header')
  })()`))

} finally {
  await drive.finish({
    intro: 'Sending with a file attached, end to end on a free model: the chip, the bubble the person reads back, and whether the file actually reached the model.'
  })
}

say('done')
