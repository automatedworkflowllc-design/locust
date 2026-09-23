// Windows High Contrast: does state still show?
//
//   node _tools/drive-high-contrast.mjs [--packaged <exe>]
//
// Yurt's beta report, 2026-09-23 (#4, forced-colors emulation on 0.278): the
// Settings switches drew as empty pills, the chosen "12" of the reply cap
// looked like every other segment, status dots vanished, and focus on the
// search box was a colour change and nothing else. Forced colors replaces
// author backgrounds and drops box-shadows, which is what all four were drawn
// with.
//
// Emulated through the DevTools protocol, the way his run did it. Each point
// is read off the computed style as well as photographed, and always against
// what is drawn BEHIND it: the first run of this drive compared an "on" track
// with an "off" one, found them different, and passed -- both were black on
// a black page. Sends nothing.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')

const drive = await startDrive({
  name: 'high-contrast',
  port: 9414,
  workspace: await scratchRepository('locust-drive-hc-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    // Relay on, so one Settings switch is on and another is off.
    settings: { swarm: false, relay: true, relayHopCap: 12, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

/** Page-script helpers: an element's own fill, and the fill it sits on. */
const PAINT = `
  const clear = (colour) => /rgba\\(0, 0, 0, 0\\)|transparent/.test(colour)
  const fill = (node) => node ? getComputedStyle(node).backgroundColor : 'missing'
  const behind = (node) => {
    let at = node?.parentElement ?? null
    while (at !== null) {
      const colour = getComputedStyle(at).backgroundColor
      if (!clear(colour)) return colour
      at = at.parentElement
    }
    return getComputedStyle(document.body).backgroundColor
  }
  const paint = (node) => ({ fill: fill(node), behind: behind(node) });
`
/** How opaque a computed colour is: `rgba(..., a)`, or 1. */
const alpha = (colour) => {
  const found = /rgba\([^)]*,\s*([\d.]+)\)/.exec(colour)
  return found === null ? 1 : Number(found[1])
}
/**
 * Drawn: a fill that is mostly opaque and not the colour under it. The second
 * run of this drive counted a 10% black on a black page as showing.
 */
const shows = (paint) => paint.fill !== 'missing' && !/transparent/.test(paint.fill) && alpha(paint.fill) >= 0.5 && paint.fill !== paint.behind

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-color-scheme', value: 'dark' }] })
  const forced = JSON.parse(await drive.evaluate(`JSON.stringify(matchMedia('(forced-colors: active)').matches)`))
  check('forced colors are on', forced === true, String(forced))

  const home = JSON.parse(await drive.capture('home, forced colors, the search box focused', () => drive.evaluate(`(async () => {
    ${PAINT}
    ${teammateFace('Wren')}?.click()
    await new Promise((r) => setTimeout(r, 500))
    document.querySelector('.lc-search input')?.focus()
    await new Promise((r) => setTimeout(r, 200))
    const box = document.querySelector('.lc-search')
    return JSON.stringify({
      dot: paint(document.querySelector('.lc-connected__dot')),
      searchOutline: box ? getComputedStyle(box).outlineStyle + ' ' + getComputedStyle(box).outlineWidth : 'no search box'
    })
  })()`)))
  check('the connected dot shows', shows(home.dot), JSON.stringify(home.dot))
  check('focus on the search box draws an outline', /^solid/.test(home.searchOutline), home.searchOutline)

  const settings = JSON.parse(await drive.capture('Settings, the page with the switches and the reply cap', () => drive.evaluate(`(async () => {
    ${PAINT}
    document.activeElement?.blur()
    const open = [...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Settings')
    open?.click()
    await new Promise((r) => setTimeout(r, 700))
    // The page that has the reply cap, whichever it is.
    for (const item of document.querySelectorAll('.lc-settings__navitem')) {
      if (document.querySelector('.lc-segmented.is-numeric')) break
      item.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    document.querySelector('.lc-segmented.is-numeric')?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    const switches = [...document.querySelectorAll('.lc-switch')]
    const on = switches.find((s) => s.classList.contains('is-on'))
    const off = switches.find((s) => !s.classList.contains('is-on'))
    const segments = [...document.querySelectorAll('.lc-segmented.is-numeric > .lc-button')]
    const chosen = segments.find((b) => b.classList.contains('is-active'))
    const other = segments.find((b) => !b.classList.contains('is-active'))
    return JSON.stringify({
      switches: switches.length,
      onTrack: paint(on), offTrack: paint(off),
      onKnob: paint(on?.querySelector('.lc-switch__knob')), offKnob: paint(off?.querySelector('.lc-switch__knob')),
      chosen: paint(chosen), other: paint(other), chosenText: chosen?.innerText ?? '',
      current: paint(document.querySelector('.lc-settings__navitem.is-current')),
      currentText: document.querySelector('.lc-settings__navitem.is-current')?.innerText ?? ''
    })
  })()`)))
  say(`settings: ${JSON.stringify(settings)}`)
  check('a switch that is on shows its fill, and differs from one that is off', shows(settings.onTrack) && settings.onTrack.fill !== settings.offTrack.fill, `${settings.onTrack.fill} on ${settings.onTrack.behind}; off ${settings.offTrack.fill}`)
  check('both knobs show against their tracks', shows(settings.onKnob) && shows(settings.offKnob), `${settings.onKnob.fill} on ${settings.onKnob.behind}; ${settings.offKnob.fill} on ${settings.offKnob.behind}`)
  check('the chosen reply cap shows, and differs from its neighbours', shows(settings.chosen) && settings.chosen.fill !== settings.other.fill, `${settings.chosenText}: ${settings.chosen.fill} on ${settings.chosen.behind}; others ${settings.other.fill}`)
  check('the current Settings page shows which it is', shows(settings.current), `${settings.currentText}: ${settings.current.fill} on ${settings.current.behind}`)
  say(failures === 0 ? '\nHIGH CONTRAST PASSED' : `\nHIGH CONTRAST: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Windows High Contrast, emulated: whether switches, segments, pages, dots and focus still show their state. Sends nothing.' })
}
