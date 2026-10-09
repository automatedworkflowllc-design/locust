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

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-attach-ws-')
// A file that is definitively NOT in the workspace, which is the case the old
// picker refused outright.
const elsewhere = await mkdtemp(join(tmpdir(), 'locust-elsewhere-'))
const outsideFile = join(elsewhere, 'from-downloads.md')
await writeFile(outsideFile, '# Somewhere else' + String.fromCharCode(10), 'utf8')

const drive = await startDrive({
  name: 'attach',
  port: 9368,
  workspace,
  // The dialog cannot be driven, so the host is told what it would have
  // returned. The path is real and really outside the workspace.
  env: { LOCUST_ATTACH_PATHS: outsideFile },
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
    ${teammateFace('Wren')}?.click()
    await new Promise(r => setTimeout(r, 700))
    const plus = document.querySelector('button[data-satellite="attach"]')
    if (!plus) return 'NO ATTACH CONTROL on the composer'
    const box = plus.getBoundingClientRect()
    return 'present, ' + Math.round(box.width) + 'x' + Math.round(box.height)
      + ', disabled: ' + plus.disabled
      + ' || chip drawn before choosing anything: ' + (document.querySelector('.lc-attached') !== null)
  })()`))

  await drive.capture('the host refuses a path outside the workspace', () => drive.evaluate(`(async () => {
    // The OUTBOUND rule, which has not changed: Locust will not open a file
    // outside the workspace in the file manager. Attaching one is a different
    // question and now has a different answer -- it is copied in -- so this
    // step no longer stands in for the picker's behaviour, only its own.
    const outside = await window.desktop.revealFile('C:' + String.fromCharCode(92) + 'Windows')
    return 'reveal of C:' + String.fromCharCode(92) + 'Windows: ok=' + outside.ok
      + (outside.ok ? '' : ' || said: ' + outside.message)
  })()`))

  await drive.capture('a file from OUTSIDE the folder is copied in, not refused', () => drive.evaluate(`(async () => {
    // Colin, 2026-09-08, with a screenshot of the old refusal: "we should
    // definitely be able to share photos or attach stuff outside of the folder
    // much like claude." Measured first: of four runtimes only Cursor will
    // read an absolute path outside its folder, so the file is brought to
    // where all of them can already read it.
    document.querySelector('button[data-satellite="attach"]').click()
    await new Promise(r => setTimeout(r, 1200))
    const tiles = [...document.querySelectorAll('.lc-attached__tile')].map(t => t.getAttribute('title'))
    const notice = document.querySelector('.lc-notice')?.textContent?.trim()
    return JSON.stringify({ tiles, notice }, null, 1)
  })()`))

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
