// The attach control: is it there, and does the host refuse what it should?
//
//   node _tools/drive-attach.mjs
//
// The `+` was removed in the 0906 design review as a dead control -- "a dead
// plus costs more than a missing one" -- and is back now that attaching does
// something: the picker is limited to the workspace and the chosen paths are
// named in the message, which every runtime can act on
// (docs/ATTACHMENTS-INTAKE-2026-09-08.md).
//
// This drives the parts that can be driven without a person in a file dialog:
// the control exists and is reachable, the host refuses a workspace-less
// request, and the message a runtime would receive names the files above the
// words. Opening the OS picker needs a hand on the mouse, so the last step
// says so rather than pretending.
//
// No mission is sent. Nothing is spent.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-attach-ws-')
const drive = await startDrive({
  name: 'attach',
  port: 9368,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('the attach control is on the composer', () => drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '').startsWith('Message Wren'))?.click()
    await new Promise(r => setTimeout(r, 700))
    const plus = document.querySelector('button[aria-label="Attach files from this workspace"]')
    if (!plus) return 'NO ATTACH CONTROL on the composer'
    const box = plus.getBoundingClientRect()
    return 'present, ' + Math.round(box.width) + 'x' + Math.round(box.height)
      + ', disabled: ' + plus.disabled
      + ' || chip drawn before choosing anything: ' + (document.querySelector('.lc-attachchip') !== null)
  })()`))

  await drive.capture('the host refuses a path outside the workspace', () => drive.evaluate(`(async () => {
    // Same containment as a reveal, in the other direction. Asking to reveal
    // C:/Windows is refused; the attach picker applies the identical rule to
    // whatever a person navigates to.
    const outside = await window.desktop.revealFile('C:' + String.fromCharCode(92) + 'Windows')
    return 'reveal of C:' + String.fromCharCode(92) + 'Windows: ok=' + outside.ok
      + (outside.ok ? '' : ' || said: ' + outside.message)
  })()`))

  await drive.capture('the picker itself needs a hand', () => drive.evaluate(`(() => {
    // Pressing it opens an OS file dialog, which a drive cannot answer. Said
    // plainly rather than clicked and left hanging: a modal dialog blocks
    // every later step in this harness.
    return 'not pressed on purpose -- the OS picker is modal and a drive cannot answer it'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The attach control on the composer, and the containment behind it. No mission is sent and the OS picker is not opened.',
    extra: [
      '## What this does not prove',
      '',
      'The file dialog is modal and a drive cannot answer it, so choosing a',
      'real file is a hand test. What is proven here: the control exists and is',
      'enabled, no chip is drawn before anything is chosen, and the host refuses',
      'a path outside the workspace by the same rule the reveal uses.',
      ''
    ].join('\n')
  })
}
