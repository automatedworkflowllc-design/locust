// Does a completed run that changed nothing say so?
//
//   node _tools/drive-no-files-changed.mjs
//
// Cursor reported completed after claiming it had applied two edits, having
// touched nothing, and the trace line never mentioned files at all. This runs
// the same shape deliberately: Accept edits is ON, the mission only reads,
// and the fold should end in `no files changed`.
//
// Free model, so it costs nothing and cannot be confused with a spent quota.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-nofiles-ws-')
const drive = await startDrive({
  name: 'no-files-changed',
  port: 9341,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const RUN = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'List the files in this folder using your read tools, then say how many there are. Do not create or change any file.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (/completed|failed|cancelled/i.test(text)) {
      const trace = document.querySelector('.lc-activity__trace, .lc-activity')
      const line = trace ? trace.innerText.split(/\\s+/).join(' ').slice(0, 200) : 'no activity fold'
      return 'settled in ' + (i + 1) + 's :: ' + (text.match(/completed|failed|cancelled/i) ?? ['?'])[0]
        + ' || mode: ' + (/may edit/i.test(text) ? 'may edit' : /read-only/i.test(text) ? 'read-only' : '?')
        + ' || trace: ' + line
    }
  }
  return 'never settled'
})()`

try {
  await drive.capture('a free model, Accept edits left ON', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = ${teammateFace('Wren')}
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('a mission that reads and changes nothing', () => drive.evaluate(RUN))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Whether the fold states that an edit-permitted run changed nothing.' })
}
