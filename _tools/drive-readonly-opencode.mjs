// Does a READ-ONLY OpenCode run reach a terminal state?
//
//   node _tools/drive-readonly-opencode.mjs
//
// The opencode smoke spends 620s and fails both its runs with
// {"started":true,"done":false}. But a plain OpenCode run settles in 21s
// (drive-runtime-completes, 2026-09-07), so the runtime is fine and the
// difference is what the smoke asks for: mode "ask" (read-only) plus a prompt
// that tries to WRITE. That is exactly the path the confinement added this
// session touches -- OPENCODE_CONFINED_CONFIG denies external_directory -- so
// the question is whether a denied write ends the run or hangs it forever.
//
// A hang here is a real defect and a beta blocker: read-only is the safe mode
// a new tester would reach for first.
//
// Spends one small OpenCode run on a free model.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-ro-ws-')
const drive = await startDrive({
  name: 'readonly-opencode',
  port: 9328,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// The smoke's own mode switch, kept identical so a difference here is a
// difference in the app and not in the instrument.
const SET_READ_ONLY = `(async () => {
  const modeControl = [...document.querySelectorAll('.lc-control')].find((b) => /ask|accept|approve/i.test(b.innerText))
  if (!modeControl) return 'no mode control'
  modeControl.click()
  await new Promise((r) => setTimeout(r, 500))
  const item = [...document.querySelectorAll('[role="menuitem"], button')].find((b) => b.innerText.trim().toLowerCase().startsWith('ask'))
  if (!item) return 'no ask item'
  item.click()
  await new Promise((r) => setTimeout(r, 500))
  return [...document.querySelectorAll('.lc-control')].map((c) => c.innerText.split(/\\s+/).join(' ').trim()).join(' | ')
})()`

const WATCH = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Create a file named blocked.txt containing hi if you can. Then, whatever happened, reply with one line starting DONE.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  const seen = []
  for (let i = 0; i < 300; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    const state = (text.match(/completed|failed|cancelled|running|Starting|stopped/i) || ['?'])[0]
    if (seen[seen.length - 1] !== state) seen.push(i + 's ' + state)
    if (/completed|failed|cancelled/i.test(text)) {
      const thread = document.querySelector('.lc-thread')
      return 'settled after ' + (i + 1) + 's :: ' + seen.join(' -> ')
        + ' || tail: ' + (thread ? thread.innerText.split(/\\s+/).join(' ').slice(-220) : 'no thread')
    }
  }
  const header = document.querySelector('.lc-workroom__header')
  return 'NEVER SETTLED in 300s :: ' + seen.join(' -> ')
    + ' || header: ' + (header ? header.innerText.split(/\\s+/).join(' ').slice(0, 200) : 'none')
})()`

try {
  await drive.capture('Wren on OpenCode / a free Muse Spark model', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
  })

  await drive.capture('the mode is read-only', () => drive.evaluate(SET_READ_ONLY))

  await drive.capture('asked to write while read-only, watched to a terminal state', () =>
    drive.evaluate(WATCH)
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro:
      'Read-only OpenCode, asked to write. The opencode smoke says this never finishes; a plain OpenCode run settles in 21s.'
  })
}
