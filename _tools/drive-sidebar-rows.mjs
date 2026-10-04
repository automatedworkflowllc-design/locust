// What are the sidebar's row-buttons, with two teammates seeded?
//
//   node _tools/drive-sidebar-rows.mjs
//
// The workroom smoke asserts "both seeded teammates are in the sidebar" by
// counting `.lc-row--button` and expecting exactly 2. It counted 3.
//
// That class is worn by four different things -- teammate rows, room rows,
// the new-room button and routine rows -- so a 3 could be a harmless extra
// control OR a teammate rendered twice, and only one of those is fine.
// Tightening the selector before knowing which would hide the real bug.
//
// Spends nothing -- it reads the sidebar.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-sidebar-ws-')
const drive = await startDrive({
  name: 'sidebar-rows',
  port: 9333,
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
      },
      {
        teammateId: 'tm_atlas',
        name: 'Atlas',
        hue: 'violet',
        role: 'Research & Briefs',
        createdAt: '2026-09-05T05:01:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const ROWS = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const rows = [...document.querySelectorAll('.lc-row--button')]
  const described = rows.map((row) => {
    const title = row.getAttribute('title') ?? ''
    const kind = title.startsWith('Message ')
      ? 'TEAMMATE'
      : row.classList.contains('lc-roomrow--new')
        ? 'new-room button'
        : row.classList.contains('lc-roomrow')
          ? 'room'
          : 'other'
    return kind + ': ' + flat(row).slice(0, 34) + (title ? ' [title: ' + title.slice(0, 24) + ']' : '')
  })
  const teammates = rows.filter((row) => (row.getAttribute('title') ?? '').startsWith('Message '))
  return 'total .lc-row--button: ' + rows.length
    + ' || teammate rows: ' + teammates.length
    + ' || ' + described.join('  ;;  ')
})()`

try {
  await drive.capture('every row-button in a two-teammate sidebar', async () => {
    await drive.ready()
    return drive.evaluate(ROWS)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Whether the third row-button is another control or a duplicated teammate.'
  })
}
