// Stop a run that has already written something. What does it claim?
//
//   node _tools/drive-stopped-midedit.mjs
//
// `drive-interrupted.mjs` covers a force-quit -- the process killed with a run
// in flight -- which is a different path from a person pressing Stop. Stop has
// never been driven against a run that had ALREADY changed the workspace, and
// that is the case where the claim is most dangerous:
//
//   if (outcome === 'failed' || outcome === 'cancelled') {
//     segments.push({ text: `stopped at ${duration}` })
//     if (outcome === 'cancelled' && files === 0)
//       segments.push({ text: 'nothing was changed' })
//   }
//
// `files` counts what the RUNTIME reported. A run stopped between writing a
// file and reporting it has files === 0 with the file sitting on disk, and
// the line then reads "nothing was changed" over a workspace that changed.
//
// That is the same class as the `no files changed` claim fixed in 0.43.4, and
// the guard added there covers only the COMPLETED branch. So this asks the
// disk, not the screen: it waits until a file genuinely exists, presses Stop,
// and then compares.
//
// One free OpenCode run, stopped part way.

import { readdir } from 'node:fs/promises'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-stopmid-ws-')

const drive = await startDrive({
  name: 'stopped-midedit',
  port: 9361,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Enough work that there is a middle to catch it in. */
const PROMPT =
  'Create six files named note-1.txt through note-6.txt, one at a time, each containing a different four-line poem about weather. Create them one by one, finishing each file before starting the next.'

const SEND = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(PROMPT)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 250))
  field.form.requestSubmit()
  return 'sent'
})()`

const STOP = `(async () => {
  const flat = (el) => el.innerText.split(String.fromCharCode(10)).map((t) => t.trim()).filter(Boolean).join(' ')
  const button = document.querySelector('button[aria-label^="Stop the running"]')
  if (!button) return 'no stop button on screen'
  button.click()
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? flat(header) : ''
    if (/cancelled|stopped|failed|completed/i.test(text)) {
      const fold = document.querySelector('.lc-activity')
      return 'header: ' + text.slice(0, 110)
        + ' || trace: ' + (fold ? flat(fold).slice(0, 150) : 'no fold')
    }
  }
  return 'never reached a terminal state after Stop'
})()`

/** Poll the DISK, not the screen: the point is to stop after a real write. */
const notesOnDisk = async () =>
  (await readdir(workspace).catch(() => [])).filter((name) => /^note-\d+\.txt$/.test(name))

try {
  await drive.capture('a free model, Accept edits', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('start six files, then wait for one to land', async () => {
    await drive.evaluate(SEND)
    for (let i = 0; i < 180; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const notes = await notesOnDisk()
      if (notes.length > 0) return `stopping with ${String(notes.length)} file(s) already written: ${notes.join(', ')}`
    }
    return 'no file was ever written -- nothing to stop mid-edit'
  })

  await drive.capture('pressed Stop', () => drive.evaluate(STOP))

  await drive.capture('what the disk says', async () => {
    const notes = await notesOnDisk()
    return notes.length === 0
      ? 'no note files on disk'
      : `${String(notes.length)} file(s) on disk: ${notes.join(', ')}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Stopping a run that had already written files, and what it claims afterwards.' })
}
