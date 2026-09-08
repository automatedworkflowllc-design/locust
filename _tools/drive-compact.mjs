// The app at the smallest window it will open: 1120x720.
//
//   node _tools/drive-compact.mjs
//
// The design pass asks for a compact layout at this exact size -- the sidebar
// becomes an avatar rail, the inspector collapses -- and every other drive runs
// at whatever size the window opens at, which on this machine is much wider.
// Ian's laptop is not 1480 wide, so this is the size that decides whether the
// app is usable for him.
//
// It needs no model and spends nothing: the layout is the subject, so a seeded
// roster and the empty state are enough to see whether anything collides.

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import './scratch-root.mjs'
import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const WIDTH = 1120
const HEIGHT = 720

const workspace = await scratchRepository('locust-drive-compact-ws-')

// The window opens at the size it last remembered, so the size is SEEDED
// rather than set afterwards. This is the real window at the real minimum --
// a device-metrics override would change what the page measures without
// changing the window Electron manages, and the layout is the subject here.
const profile = join(homedir(), 'Documents', 'locust-scratch', `locust-compact-${String(Date.now())}`)
await mkdir(profile, { recursive: true })
await writeFile(
  join(profile, 'window.json'),
  JSON.stringify({ x: 40, y: 40, width: WIDTH, height: HEIGHT, maximized: false }),
  'utf8'
)

const drive = await startDrive({
  name: 'compact',
  port: 9365,
  workspace,
  profilePath: profile,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-05T05:01:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture(`launch at ${String(WIDTH)}x${String(HEIGHT)}`, async () => {
    await drive.ready()
    return drive.evaluate(`window.innerWidth + 'x' + window.innerHeight`)
  })

  await drive.capture('is the sidebar a rail, and does anything overflow', () => drive.evaluate(`(() => {
    const sidebar = document.querySelector('.lc-sidebar')
    const width = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : -1
    // Anything wider than the window is the failure this drive exists to find.
    const tooWide = [...document.querySelectorAll('body *')]
      .filter(node => node.getBoundingClientRect().width > window.innerWidth + 1)
      .map(node => node.className && typeof node.className === 'string' ? node.className.split(' ')[0] : node.tagName)
    const scrolls = document.documentElement.scrollWidth > window.innerWidth + 1
    return 'sidebar: ' + width + 'px || body scrolls sideways: ' + scrolls
      + ' || wider than the window: [' + [...new Set(tooWide)].slice(0, 6).join(', ') + ']'
  })()`))

  await drive.capture('the composer row at this width', () => drive.evaluate(`(() => {
    const row = document.querySelector('.command-dock')
    if (!row) return 'no composer'
    const controls = [...document.querySelectorAll('.lc-control')]
    const box = row.getBoundingClientRect()
    const overflowing = controls.filter(c => c.getBoundingClientRect().right > box.right + 1).length
    return controls.length + ' controls, ' + overflowing + ' past the right edge'
  })()`))

  // A real mission, because the workroom and its inspector only exist once
  // there is one -- and the workroom at this width is the thing Ian will
  // actually be looking at. One short run on Cursor, so it costs almost
  // nothing.
  await drive.capture('run one short mission at this width', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren')?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok-4.6', row: '/grok-4.6/i' }))
    await drive.evaluate(sendAndWaitScript('Reply with exactly one word: ready. Use no tools.', { waitSeconds: 240 }))
    return drive.evaluate(`(() => {
      const header = document.querySelector('.lc-workroom__mission')
      return header ? header.innerText.split(String.fromCharCode(10)).join(' ').slice(0, 140) : 'no workroom header'
    })()`)
  })
  // The inspector used to be display:none at this width, which made the
  // signal rail, the receipt and the Artifacts tab unreachable on the
  // smallest window the app opens.
  await drive.capture('can the inspector still be opened at this width', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => /Activity/.test(b.innerText))
    if (!button) return 'no way to open the inspector on screen'
    button.click()
    await new Promise(r => setTimeout(r, 700))
    const panel = document.querySelector('.lc-inspector')
    if (!panel) return 'INSPECTOR DID NOT RENDER'
    const box = panel.getBoundingClientRect()
    const visible = box.width > 0 && box.right <= window.innerWidth + 1
    const tabs = [...document.querySelectorAll('.lc-tab')].map(t => t.innerText.trim())
    return (visible ? 'open, ' : 'RENDERED BUT NOT VISIBLE, ') + Math.round(box.width) + 'px wide, tabs: [' + tabs.join(', ') + ']'
  })()`))

} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `The app at ${String(WIDTH)}x${String(HEIGHT)}, the smallest window it will open and the size the design pass specifies a compact layout for.`,
    extra: ['## Read the PNGs', '', 'Numbers say nothing about whether it LOOKS right at this size.', ''].join('\n')
  })
}
