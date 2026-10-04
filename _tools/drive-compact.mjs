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
// It spends nothing: the layout is the subject, and the one mission it sends
// -- the workroom only exists once there is one -- goes on OpenCode's free
// model. Until 2026-09-22 it went on Cursor's Grok while this line said it
// spent nothing; the app now refuses a paid route in any scripted window.

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import './scratch-root.mjs'
import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

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
    // The chain the width comes down through, so an overflow names its cause:
    // the container query measures .lc-composer, the person sees the box.
    const width = (selector) => { const el = document.querySelector(selector); return el ? Math.round(el.getBoundingClientRect().width) : null }
    const chain = ['.lc-composer', '.lc-composer__inner', '.lc-composer__box', '.lc-composer__controls'].map(s => s + ' ' + width(s)).join(' / ')
    const each = controls.map(c => (c.getAttribute('aria-label') || c.innerText.trim().slice(0, 18)) + ' ' + Math.round(c.getBoundingClientRect().width)).join(', ')
    return controls.length + ' controls, ' + overflowing + ' past the right edge // ' + chain + ' // ' + each
  })()`))

  // A real mission, because the workroom and its inspector only exist once
  // there is one -- and the workroom at this width is the thing Ian will
  // actually be looking at. On the free route, so it costs nothing.
  await drive.capture('run one short mission at this width', async () => {
    // By aria-label in the rail: the avatar carries no native title there (the
    // flyout says the same facts), and a title-only selector silently clicked
    // nothing -- so the mission below was sent with nobody selected and the
    // flyout, correctly, listed no conversations for Wren (2026-09-08).
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
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

  // The rail's own tidiness, after Colin's screenshot: no sideways scrollbar,
  // no conversation rows squeezed into four pixels, no tall empty box round
  // the selected avatar.
  await drive.capture('is the rail itself tidy', () => drive.evaluate(`(() => {
    const scroll = document.querySelector('.lc-sidebar__scroll')
    const sideways = scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false
    const missions = [...document.querySelectorAll('.lc-teammate__missions')]
      .filter(n => n.getBoundingClientRect().height > 0).length
    const selected = document.querySelector('.lc-teammate.is-selected')
    const selectedHeight = selected ? Math.round(selected.getBoundingClientRect().height) : 0
    return 'rail scrolls sideways: ' + sideways
      + ' || conversation lists drawn: ' + missions
      + ' || selected box height: ' + selectedHeight + 'px'
  })()`))

  // The rail flyout (design agent, 2026-09-08). Hover is driven with
  // mouseover/mouseout, not mouseenter/mouseleave: React derives its enter and
  // leave handlers from the former and never listens for the latter, so a
  // dispatched mouseenter is a hover that no handler ever sees. Hover an avatar and that
  // teammate's conversations open beside the rail; click pins; Esc unpins.
  // By now Wren has one conversation from the mission above.
  await drive.capture('hover Wren in the rail: does the flyout open', () => drive.evaluate(`(async () => {
    const slot = [...document.querySelectorAll('.lc-railslot')][0]
    if (!slot) return 'no rail slot'
    slot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await new Promise(r => setTimeout(r, 400))
    const panel = document.querySelector('.lc-railflyout')
    if (!panel) return 'NO FLYOUT after hover'
    const box = panel.getBoundingClientRect()
    const rail = document.querySelector('.lc-sidebar').getBoundingClientRect()
    const rows = [...panel.querySelectorAll('.lc-railflyout__row')].map(r => r.innerText.split(String.fromCharCode(10)).join(' ').trim())
    // The premise, checked: the hidden full-sidebar rows are still in the DOM
    // in the rail, so counting them says whether Wren OWNS a conversation at
    // this instant -- and the unowned MISSIONS rows say where it went if not.
    const ownedInDom = document.querySelectorAll('.lc-railslot .lc-teammate__mission').length
    const unownedInDom = document.querySelectorAll('.lc-row--mission').length
    return 'flyout ' + Math.round(box.width) + 'px wide, left edge ' + Math.round(box.left - rail.right) + 'px past the rail'
      + ' || owned rows in DOM: ' + ownedInDom + ' || unowned rows in DOM: ' + unownedInDom
      + ' || header: ' + (panel.querySelector('.lc-railflyout__name')?.innerText ?? '?')
      + ' || rows: [' + rows.join(' | ') + ']'
      + ' || count: ' + (panel.querySelector('.lc-railflyout__count')?.innerText ?? 'none')
  })()`))

  await drive.capture('move the pointer away: does it close, then click to pin', () => drive.evaluate(`(async () => {
    // Clear any pin first. Selecting Wren for the mission above is a click on
    // the avatar, and click pins by design -- so without this the leave below
    // finds a pinned panel and the click UNpins it, which read as both halves
    // failing on the first run of this step.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const slot = [...document.querySelectorAll('.lc-railslot')][0]
    slot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
    await new Promise(r => setTimeout(r, 400))
    slot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    await new Promise(r => setTimeout(r, 400))
    const closed = document.querySelector('.lc-railflyout') === null
    slot.querySelector('button').click()
    await new Promise(r => setTimeout(r, 400))
    const pinned = document.querySelector('.lc-railflyout') !== null
    slot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    await new Promise(r => setTimeout(r, 400))
    const stays = document.querySelector('.lc-railflyout') !== null
    return 'closed on leave: ' + closed + ' || open after click: ' + pinned + ' || survives the pointer leaving: ' + stays
  })()`))

  await drive.capture('Esc unpins; the avatar has no native tooltip in the rail', () => drive.evaluate(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const gone = document.querySelector('.lc-railflyout') === null
    const button = document.querySelector('.lc-railslot button')
    return 'gone after Esc: ' + gone + ' || title attr: ' + (button?.getAttribute('title') ?? 'none') + ' || aria-label: ' + (button?.getAttribute('aria-label') ?? 'none').slice(0, 60)
  })()`))

  // The layout is a CHOICE as well as a consequence of window size. At this
  // width auto gives the rail; asking for the full sidebar must win anyway.
  await drive.capture('force the full sidebar at this width from Settings', () => drive.evaluate(`(async () => {
    // By TITLE, not by text: the rail hides button labels, which is the whole
    // point of the rail and the reason an innerText selector found nothing.
    const settings = [...document.querySelectorAll('button')].find(b => /^Settings/.test(b.getAttribute('title') || ''))
    if (!settings) return 'no Settings button'
    settings.click()
    await new Promise(r => setTimeout(r, 900))
    // Settings opens on its first page; the layout control is on Appearance
    // (Batch D drive rot: this looked on the first page and found nothing).
    ;[...document.querySelectorAll('button, a')].find(b => b.innerText.trim() === 'Appearance')?.click()
    await new Promise(r => setTimeout(r, 600))
    const group = [...document.querySelectorAll('[role=radiogroup]')].find(g => /Sidebar layout/.test(g.getAttribute('aria-label') || ''))
    if (!group) return 'no Sidebar layout control in Settings'
    const full = [...group.querySelectorAll('button')].find(b => b.innerText.trim() === 'Full')
    if (!full) return 'no Full option'
    full.click()
    await new Promise(r => setTimeout(r, 900))
    const sidebar = document.querySelector('.lc-sidebar')
    const width = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : -1
    return 'after choosing Full at ' + window.innerWidth + 'px: sidebar is ' + width + 'px'
  })()`))

  await drive.capture('and back to Rail', () => drive.evaluate(`(async () => {
    const group = [...document.querySelectorAll('[role=radiogroup]')].find(g => /Sidebar layout/.test(g.getAttribute('aria-label') || ''))
    const rail = group ? [...group.querySelectorAll('button')].find(b => b.innerText.trim() === 'Rail') : undefined
    if (!rail) return 'no Rail option'
    rail.click()
    await new Promise(r => setTimeout(r, 900))
    const sidebar = document.querySelector('.lc-sidebar')
    return 'after choosing Rail: sidebar is ' + (sidebar ? Math.round(sidebar.getBoundingClientRect().width) : -1) + 'px'
  })()`))

} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `The app at ${String(WIDTH)}x${String(HEIGHT)}, the smallest window it will open and the size the design pass specifies a compact layout for.`,
    extra: ['## Read the PNGs', '', 'Numbers say nothing about whether it LOOKS right at this size.', ''].join('\n')
  })
}
