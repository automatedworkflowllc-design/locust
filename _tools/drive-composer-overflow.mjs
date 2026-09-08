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

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

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
    rightEnd: (() => {
      const effort = row.querySelector('.lc-effortbar, .lc-effortchip, [class*="effort"]')
      const swarm = row.querySelector('.lc-swarm')
      const b = node => node ? { l: Math.round(node.getBoundingClientRect().left), r: Math.round(node.getBoundingClientRect().right) } : null
      const e = b(effort), w = b(swarm)
      return {
        effort: e, swarm: w,
        gap: e && w ? w.l - e.r : null,
        moth: (() => {
          const img = row.querySelector('.lc-swarm img')
          if (!img) return null
          const i = img.getBoundingClientRect()
          const btn = row.querySelector('.lc-swarm').getBoundingClientRect()
          return { imgWidth: Math.round(i.width), buttonWidth: Math.round(btn.width), spillsLeftBy: Math.round(btn.left - i.left) }
        })(),
        overlapping: e && w ? w.l < e.r : null
      }
    })(),
    children: [...row.children].map(group => ({
      group: Math.round(group.getBoundingClientRect().width),
      items: [...group.children].map(node => ({
        what: (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 22),
        w: Math.round(node.getBoundingClientRect().width)
      }))
    }))
  }, null, 1)
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('open a mission on a long model name', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('the row with nothing attached', () => drive.evaluate(measure))

  await drive.capture('attach a file', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Attach files"]')?.click()
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
