// Does the composer say how to type a newline?
//
//   node _tools/drive-newline-hint.mjs
//
// A first outside tester lost their opening mission to this: they typed a
// two-line prompt, the first Enter submitted the first line, and the rest
// queued behind it as NEXT until the conversation had closed. Shift+Enter
// always worked; nothing said so.
//
// The hint is drawn only while there is something in the box, so this types
// and then looks.
//
// Spends nothing.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-hint-ws-')
const drive = await startDrive({
  name: 'newline-hint',
  port: 9345,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const read = `(async () => {
  const hint = document.querySelector('.lc-composer__newline')
  const send = [...document.querySelectorAll('form.command-dock button')].find((b) => b.getAttribute('aria-label') === 'Start mission')
  return 'hint: ' + (hint ? JSON.stringify(hint.innerText.trim()) : 'ABSENT')
    + ' || send title: ' + (send ? JSON.stringify(send.getAttribute('title')) : 'no send button')
})()`

try {
  await drive.capture('at rest, with an empty box', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = ${teammateFace('Wren')}
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(read)
  })

  await drive.capture('while typing, which is when it matters', async () => {
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Replace notes.txt so it contains exactly two lines:')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 600))
    })()`)
    return drive.evaluate(read)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The newline hint: absent at rest, present while there is something to send.' })
}
