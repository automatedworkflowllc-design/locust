// Does the composer's control row still fit once a file is attached?
//
//   node _tools/drive-composer-overflow.mjs
//
// Colin, 2026-09-08, watching a drive: "effort bar was sliding off the UI a
// bit ... when a file is attached". The row is `flex-wrap: nowrap` on purpose
// -- a wrapped bar reads as broken -- and it fits by truncating the folder and
// model names. The `1 file` chip is a NEW fixed-width item on that row, and
// nothing gave it back the space it takes.
//
// This measures every child against the row, with and without the attachment,
// so the fix has a number to beat. Nothing is sent.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-overflow-ws-')
const drive = await startDrive({
  name: 'composer-overflow',
  port: 9389,
  workspace,
  env: { LOCUST_ATTACH_PATHS: `${workspace}/NOTES.md` },
  files: { 'NOTES.md': '# Notes\n' },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const measure = `(() => {
  const row = document.querySelector('.lc-composer__controls')
  if (!row) return 'no control row'
  const box = row.getBoundingClientRect()
  const children = [...row.querySelectorAll('.lc-control, .lc-composer__group > *')]
  const past = children
    .map(node => ({
      what: (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 28),
      right: Math.round(node.getBoundingClientRect().right)
    }))
    .filter(entry => entry.right > Math.round(box.right) + 1)
  return JSON.stringify({
    rowRight: Math.round(box.right),
    rowWidth: Math.round(box.width),
    scrollWidth: row.scrollWidth,
    overflowBy: Math.max(0, row.scrollWidth - Math.round(box.width)),
    pastTheEdge: past,
    // The effort control at the row's right end. The swarm pill that sat beside it left the row (swarm is a
    // Settings switch, said by a chip in the title bar), so there is no neighbour to overlap any more.
    rightEnd: (() => {
      const effort = row.querySelector('[aria-label="Reasoning effort"]')
      const box = effort ? effort.getBoundingClientRect() : null
      return { effort: box ? { l: Math.round(box.left), r: Math.round(box.right) } : null, insideTheRow: box ? box.right <= row.getBoundingClientRect().right + 0.5 : null }
    })(),
    children: [...row.children].map(group => ({
      group: Math.round(group.getBoundingClientRect().width),
      items: [...group.children].map(node => ({
        what: (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 22),
        w: Math.round(node.getBoundingClientRect().width)
      }))
    }))
  }, null, 1)
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a long model name', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('the row with nothing attached', () => drive.evaluate(measure))

  await drive.capture('attach a file', () => drive.evaluate(`(async () => {
    document.querySelector('button[data-satellite="attach"]')?.click()
    await new Promise(r => setTimeout(r, 900))
    return 'attached'
  })()`))

  await drive.capture('THE ROW with a file attached', () => drive.evaluate(measure))
} finally {
  await drive.finish({
    intro: 'Whether the composer control row still fits once the attachment chip is on it.'
  })
}

say('done')
