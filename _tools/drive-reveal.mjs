// Can you get at the file your teammate just wrote?
//
//   node _tools/drive-reveal.mjs
//
// Colin, 2026-09-07, dogfooding: a teammate generated a report, said its name,
// and there was nothing to click. The file was on disk the whole time.
//
// This drives the answer end to end on the built app: a real run that writes a
// real file, then the two places that now offer to show it -- the activity
// fold's file row and the Inspector's Artifacts tab, which had promised
// artifacts since it was built and never listed one.
//
// It also drives the REFUSAL, which is the half that matters more. The host
// honours a reveal only for a path inside a workspace it already knows;
// `main/index.ts` states the rule the whole feature had to fit ("the renderer
// names no destinations"), so the drive asks for `C:\Windows\...` and expects
// to be told no. That call opens nothing, which is the point.
//
// One real Explorer window opens at the very end, after every capture, because
// a feature whose whole job is to open a window is not proven by a button that
// exists. Close it afterwards.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-reveal-ws-')
const drive = await startDrive({
  name: 'reveal',
  port: 9363,
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

  await drive.capture('Wren on Cursor / grok 4.6, accept edits', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok-4.6', row: '/grok-4.6/i' }))
  })

  await drive.capture('write one small file', () =>
    drive.evaluate(sendAndWaitScript('Create a file called report.md containing exactly one line: hello. Then stop.', { waitSeconds: 300 }))
  )

  // Open the fold, because the file rows live inside it.
  await drive.capture('open the activity fold and look for a reveal control', () => drive.evaluate(`(async () => {
    // The fold's own toggle is button.lc-activity. An earlier guess at
    // .lc-activity__summary matched nothing and read as a missing feature.
    // No backticks in here: one inside this template literal closes it.
    const fold = document.querySelector('button.lc-activity')
    if (fold) { fold.click(); await new Promise(r => setTimeout(r, 600)) }
    const rows = [...document.querySelectorAll('.lc-filerow__path')].map(n => n.innerText.trim())
    const reveals = [...document.querySelectorAll('.lc-filerow__reveal')]
    return 'file rows: [' + rows.join(', ') + '] || reveal controls: ' + reveals.length
      + (reveals[0] ? ' || first says: ' + reveals[0].getAttribute('aria-label') : ' || NO REVEAL CONTROL')
  })()`))

  await drive.capture('the Inspector Artifacts tab, which used to always be empty', () => drive.evaluate(`(async () => {
    const open = [...document.querySelectorAll('button')].find(b => /Activity/.test(b.innerText) && b.closest('.lc-workroom__header'))
    if (open) { open.click(); await new Promise(r => setTimeout(r, 600)) }
    const tab = [...document.querySelectorAll('.lc-tab')].find(b => b.innerText.trim() === 'Artifacts')
    if (!tab) return 'no Artifacts tab on screen'
    tab.click()
    await new Promise(r => setTimeout(r, 500))
    const empty = document.querySelector('.lc-inspector__empty')
    const listed = [...document.querySelectorAll('.lc-artifacts__path')].map(n => n.innerText.trim())
    return listed.length > 0
      ? 'listed: ' + listed.join(', ')
      : 'STILL EMPTY: ' + (empty ? empty.innerText.trim() : 'no rows and no empty state')
  })()`))

  // The refusal. This is the security claim, and it is the one worth driving:
  // a path outside the workspace must be told no, and must open nothing.
  await drive.capture('ask the host to reveal something outside the workspace', () => drive.evaluate(`(async () => {
    const answer = await window.desktop.revealFile('C:' + String.fromCharCode(92) + 'Windows' + String.fromCharCode(92) + 'System32')
    return 'ok=' + answer.ok + (answer.ok ? '' : ' || said: ' + answer.message)
  })()`))

  await drive.capture('and one with no path at all', () => drive.evaluate(`(async () => {
    const answer = await window.desktop.revealFile('')
    return 'ok=' + answer.ok + (answer.ok ? '' : ' || said: ' + answer.message)
  })()`))

  // Last, because it takes the foreground.
  await drive.capture('press the real thing: does a window open', () => drive.evaluate(`(async () => {
    const button = document.querySelector('.lc-filerow__reveal')
    if (!button) return 'no reveal control to press'
    button.click()
    await new Promise(r => setTimeout(r, 1200))
    const notice = document.querySelector('.lc-filerow__notice')
    return notice ? 'REFUSED: ' + notice.innerText.trim() : 'pressed, and the card said nothing -- which is the success case'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Wren on Cursor Agent / grok 4.6, accept edits, writing one file -- then the two places that offer to show it, and the two the host must refuse.',
    extra: [
      '## What this proves',
      '',
      '1. A file the teammate wrote has a reveal control on its row.',
      '2. The Inspector Artifacts tab lists it instead of saying it has none.',
      '3. A path outside the workspace is refused, and opens nothing.',
      '4. Pressing the control really opens a window (check the screen; an',
      '   Explorer window is left open on purpose).',
      ''
    ].join('\n')
  })
}
