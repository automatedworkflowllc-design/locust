// Does lime mean one thing in the sidebar, now that selection stopped using it?
//
//   node _tools/probe-lime-means-one-thing.mjs
//
// The design agent, 2026-09-10: "Lime means both 'selected' and 'working'. A
// selected card that is also thinking is two nested lime surfaces; 'Finance
// Bro - thinking' is tinted whole when only the state word should be." Their
// ruling was: all the way -- selection gets no lime surface at all, the 2px
// bar stays lime because a bar is a position marker rather than a surface,
// the state word takes the tone, the role stays muted because identity has no
// state to borrow, and a conversation row inside a selected card goes neutral
// because selected-within-selected says nothing the first surface did not.
//
// I shipped that in 0.66.1 from the list, without ever looking at the case it
// is about: a teammate that is BOTH selected and working. This looks at it,
// and reads the computed colours rather than judging a screenshot by eye --
// "is that lime" is exactly the question a person answers wrong.
//
// SPENDS NOTHING: OpenCode's free model, which needs no account.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, FREE_ROUTE } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-lime-ws-')
const now = '2026-09-05T05:00:00.000Z'
const route = { ...FREE_ROUTE, mode: 'ask' }

const drive = await startDrive({
  name: 'lime-means-one-thing',
  port: 9489,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Docs & QA', createdAt: now, route },
      { teammateId: 'tm_jim', name: 'Jimothy', hue: 'clay', role: 'Custom', roleTitle: 'Finance Bro', createdAt: now, route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// No backticks inside these template literals.
const startAndSelect = `(async () => {
  const wren = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))
  if (wren === undefined) return 'no Wren'
  wren.click()
  await new Promise(r => setTimeout(r, 700))
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Count slowly from 1 to 60, one number per line, with a sentence about each.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  // Wait until the card is BOTH selected and working, which is the case the
  // ruling is about and the only one worth photographing.
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('.lc-teammate.is-selected')
    const state = card?.querySelector('.lc-row__metastate')?.innerText.trim() ?? ''
    if (card !== null && /thinking|working|replying/i.test(state)) return 'selected and working: ' + state
  }
  return 'never reached selected-and-working'
})()`

/**
 * What is lime, and what is not. Read as computed colour, and compared
 * against the tokens themselves rather than against a hex I typed here --
 * a test that hardcodes #b8e986 passes for the wrong reason the day the
 * palette moves.
 */
const readTones = `(() => {
  const root = getComputedStyle(document.documentElement)
  const asRgb = (value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const seen = getComputedStyle(probe).color
    probe.remove()
    return seen
  }
  const lime = asRgb(root.getPropertyValue('--lc-lime-text').trim())
  const muted = asRgb(root.getPropertyValue('--lc-text-muted').trim())
  const selectedBg = asRgb(root.getPropertyValue('--lc-bg-selected').trim())
  const card = document.querySelector('.lc-teammate.is-selected')
  if (card === null) return JSON.stringify({ error: 'no selected card' })
  const of = (selector) => {
    const node = card.querySelector(selector)
    return node === null ? null : { text: node.innerText.trim(), colour: getComputedStyle(node).color }
  }
  const role = of('.lc-row__metarole')
  const state = of('.lc-row__metastate')
  const activeRow = card.querySelector('.lc-teammate__mission.is-active')
  const bar = getComputedStyle(card, '::before')
  return JSON.stringify({
    tokens: { lime, muted, selectedBg },
    role,
    state,
    roleIsMuted: role?.colour === muted,
    roleIsLime: role?.colour === lime,
    stateIsLime: state?.colour === lime,
    cardBackground: getComputedStyle(card).backgroundColor,
    cardIsTheNeutralSelectedSurface: getComputedStyle(card).backgroundColor === selectedBg,
    nestedRowBackground: activeRow === null ? 'no active row' : getComputedStyle(activeRow).backgroundColor,
    nestedRowIsTransparent: activeRow === null ? null : /rgba\\(0, 0, 0, 0\\)|transparent/.test(getComputedStyle(activeRow).backgroundColor),
    barWidth: bar.width
  }, null, 1)
})()`

const readRail = `(() => {
  const root = getComputedStyle(document.documentElement)
  const asRgb = (value) => {
    const probe = document.createElement('span')
    probe.style.color = value
    document.body.appendChild(probe)
    const seen = getComputedStyle(probe).color
    probe.remove()
    return seen
  }
  const shell = document.querySelector('.lc-shell')
  const card = document.querySelector('.lc-teammate.is-selected')
  if (card === null) return JSON.stringify({ error: 'no selected card in the rail' })
  const bar = getComputedStyle(card, '::before')
  return JSON.stringify({
    compact: shell?.classList.contains('is-compact') === true,
    barWidth: bar.width,
    barBackground: bar.backgroundColor,
    barIsLime: bar.backgroundColor === asRgb(root.getPropertyValue('--lc-lime').trim()),
    cardBackground: getComputedStyle(card).backgroundColor
  }, null, 1)
})()`

try {
  await drive.capture('a teammate that is selected AND working', async () => {
    await drive.ready()
    const reached = await drive.evaluate(startAndSelect)
    if (typeof reached === 'string' && reached.startsWith('never')) return `NOT THE TEST: ${reached}`
    return String(reached)
  })

  const tones = String(await drive.evaluate(readTones))
  await drive.capture('what is lime on that card, and what is not', async () => tones)
  // Written whole as well: the session table truncates a long note, and the
  // whole point of this probe is the values.
  await writeFile(join(drive.out, 'tones.json'), tones, 'utf8')
  say(`  wide: ${tones.replace(/\s+/g, ' ')}`)

  /*
   * And the one lime object selection IS allowed.
   *
   * The full sidebar has no bar at all -- selection there is the neutral
   * surface plus a border -- so the first pass read its width as `auto` and
   * proved nothing. The bar belongs to the 64px rail, where there is no room
   * for a labelled surface and a marker is the only way to say "you are
   * here". Compact is what any window at or under 1199 draws.
   */
  await drive.resize(1120, 760)
  await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
  const railTones = String(await drive.evaluate(readRail))
  await drive.capture('the rail: one lime object, four pixels wide', async () => railTones)
  await writeFile(join(drive.out, 'rail.json'), railTones, 'utf8')
  say(`  compact: ${railTones.replace(/\s+/g, ' ')}`)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on OpenCode’s free model, one of them selected and running, so the sidebar shows the exact case the ruling was about. Colours are read computed and compared against the tokens, not against a hex written into the probe.'
  })
}
