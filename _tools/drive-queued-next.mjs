// Does the next line you type survive the run starting?
//
//   node _tools/drive-queued-next.mjs
//
// A first outside tester, 0.38.7 finding 13: after Enter split their prompt,
// NEXT read "held -- that conversation is no longer open" -- about the
// conversation that was on screen.
//
// A mission is created under a TEMPORARY key and moved to the host's real
// runId the moment the host answers, and the temporary key is deleted in the
// same breath. `shownKey` followed that move; the queue did not. So a message
// typed in the window between pressing Enter and the host answering pointed
// at a key that no longer existed.
//
// This types the second line into exactly that window, which is what a person
// who thinks Enter is a newline does without trying.
//
// Free model, so it costs no quota.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-queued-ws-')
await writeFile(join(workspace, 'notes.md'), '# notes\n', 'utf8')

const drive = await startDrive({
  name: 'queued-next',
  port: 9352,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// Both lines typed the way the tester typed them: Enter, then Enter again,
// with no pause. The second press lands while the host is still answering the
// first.
const TYPE_BOTH = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const send = (text) => {
    setter.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.form.requestSubmit()
  }
  send('Say the single word READY and nothing else.')
  // No wait: this is the window. A pause here is the drive testing a
  // different thing than the person did.
  send('Now say the single word SECOND and nothing else.')
  await new Promise((r) => setTimeout(r, 1200))
  const strip = document.querySelector('.lc-queued')
  const note = document.querySelector('.lc-queued__note')
  const text = document.querySelector('.lc-queued__text')
  return strip === null
    ? 'nothing queued -- the second line did not land in the window'
    : 'queued: ' + (text ? text.innerText.trim() : '(no text)')
      + ' || note: ' + (note ? note.innerText.trim() : '(no note)')
})()`

const SETTLE = `(async () => {
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const strip = document.querySelector('.lc-queued')
    const bubbles = [...document.querySelectorAll('.lc-bubble')].map(flat)
    // The queue is gone AND the second line is on screen as its own turn:
    // that is the message having actually been sent, not merely dropped.
    if (strip === null && bubbles.some((t) => t.includes('SECOND'))) {
      return 'the queued line was sent -- turns: ' + bubbles.join(' // ')
    }
    if (i > 60) {
      const note = document.querySelector('.lc-queued__note')
      return 'still queued after ' + String(i) + 's || note: ' + (note ? note.innerText.trim() : '(no note)')
        + ' || turns: ' + bubbles.join(' // ')
    }
  }
  return 'never settled'
})()`

try {
  await drive.capture('a free model, Accept edits', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('two lines, no pause between them', () => drive.evaluate(TYPE_BOTH))

  await drive.capture('and the second one actually goes', () => drive.evaluate(SETTLE))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The next line, typed before the host had answered the first.' })
}
