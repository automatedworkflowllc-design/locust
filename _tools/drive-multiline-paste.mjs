// Does a pasted multi-line prompt survive as ONE message?
//
//   node _tools/drive-multiline-paste.mjs
//
// A first outside tester's top Stop finding (0.38.7, finding 1): "Enter
// sends. Multi-line prompts are shredded into a NEXT queue... A coding app
// that cannot take a paste with newlines is not ready."
//
// That is two claims. The second -- that a PASTE is shredded -- is the one
// that would make the app unusable, and it is testable. The composer has no
// paste handler at all, so it should not be true; but "should not be true"
// is what I said about the diff counter before it turned out to be true, so
// this measures it.
//
// `Input.insertText` over CDP is what a real paste does to a focused field:
// it inserts the text, newlines and all, without any key events. A synthetic
// ClipboardEvent would prove nothing -- Chromium does not run the default
// action for an untrusted event, so nothing would be inserted either way.
//
// Costs no quota: nothing is ever sent to a model. The bubble is drawn the
// instant a turn is submitted, which is all this needs to see.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const PASTED = 'Replace notes.md so the file contains exactly two lines:\nlocust-was-here\nsecond-line-ok'

const workspace = await scratchRepository('locust-paste-ws-')
await writeFile(join(workspace, 'notes.md'), '# notes\n', 'utf8')

const drive = await startDrive({
  name: 'multiline-paste',
  port: 9353,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('a three-line prompt, pasted', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = ${teammateFace('Wren')}
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
      const field = document.querySelector('form.command-dock textarea')
      if (field) field.focus()
    })()`)
    // The real thing: no key events, no synthetic event, just the text
    // arriving in the focused field the way the clipboard delivers it.
    await drive.send('Input.insertText', { text: PASTED })
    return drive.evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 400))
      const field = document.querySelector('form.command-dock textarea')
      const value = field ? field.value : '(no field)'
      return 'lines in the box: ' + String(value.split(String.fromCharCode(10)).length)
        + ' || whole prompt intact: ' + (value === ${JSON.stringify(PASTED)} ? 'YES' : 'NO')
        + ' || box holds: ' + JSON.stringify(value)
    })()`)
  })

  await drive.capture('and it sends as one turn', () =>
    drive.evaluate(`(async () => {
      const flat = (el) => el.innerText.split(String.fromCharCode(10)).map((t) => t.trim()).filter(Boolean).join(' / ')
      const field = document.querySelector('form.command-dock textarea')
      field.form.requestSubmit()
      await new Promise((r) => setTimeout(r, 1500))
      const bubbles = [...document.querySelectorAll('.lc-bubble')].map(flat)
      const strip = document.querySelector('.lc-queued')
      // One bubble carrying all three lines, and nothing shunted into NEXT.
      const whole = bubbles.find((t) => t.includes('locust-was-here') && t.includes('second-line-ok'))
      return 'turns on screen: ' + String(bubbles.length)
        + ' || all three lines in one turn: ' + (whole === undefined ? 'NO' : 'YES')
        + ' || NEXT queue: ' + (strip === null ? 'empty' : 'HOLDS ' + flat(strip))
        + ' || first turn: ' + JSON.stringify(bubbles[0] ?? '(none)')
    })()`)
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'A pasted three-line prompt, and whether it stays one message.' })
}
