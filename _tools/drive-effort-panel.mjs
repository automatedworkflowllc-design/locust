// The effort control, on a model with a lot of levels.
//
//   node _tools/drive-effort-panel.mjs
//
// Colin, 2026-09-08, with a screenshot of the old menu: "not only does this
// bleed off, this is way too much" -- eight rows, each with a sentence under
// it, running off the bottom of the window and off its right edge. Then the
// fix: "you could just use claudes ... and then if there is a fast option just
// have a toggle for it."
//
// This opens the control on Cursor's grok, which lists eight levels, and
// measures whether the panel stays inside the window. No mission is sent, so
// nothing is spent: the panel is the whole subject.

import { pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-effortpanel-ws-')
const drive = await startDrive({
  name: 'effort-panel',
  port: 9367,
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

  await drive.capture('choose Cursor grok, which lists eight effort levels', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok', row: '/grok/i' }))
  })

  await drive.capture('open the effort control and measure it', () => drive.evaluate(`(async () => {
    const chip = document.querySelector('button[aria-label="Reasoning effort"]')
    if (!chip) return 'no effort control on the composer'
    chip.click()
    await new Promise(r => setTimeout(r, 600))
    const panel = document.querySelector('.lc-effortpanel')
    if (!panel) return 'the panel did not open'
    const box = panel.getBoundingClientRect()
    const slider = panel.querySelector('input[type=range]')
    const fast = panel.querySelector('[role=switch]')
    const insideRight = box.right <= window.innerWidth + 1
    const insideTop = box.top >= -1
    return 'panel ' + Math.round(box.width) + 'x' + Math.round(box.height)
      + ' || inside the window: ' + (insideRight && insideTop)
      + ' || stops: ' + (slider ? Number(slider.max) + 1 : 0)
      + ' || now: ' + (panel.querySelector('.lc-effortpanel__now')?.innerText.trim() ?? '?')
      + ' || fast switch: ' + (fast ? 'yes' : 'no')
  })()`))

  await drive.capture('drag it to the top of the scale', () => drive.evaluate(`(async () => {
    const slider = document.querySelector('.lc-effortpanel__slider')
    if (!slider) return 'no slider'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, slider.max)
    slider.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const chip = document.querySelector('button[aria-label="Reasoning effort"]')
    return 'panel says: ' + (document.querySelector('.lc-effortpanel__now')?.innerText.trim() ?? '?')
      + ' || chip says: ' + (chip?.innerText.split(String.fromCharCode(10)).join(' ').trim() ?? '?')
  })()`))

  await drive.capture('turn the fast variant on', () => drive.evaluate(`(async () => {
    const fast = document.querySelector('.lc-effortpanel__fast')
    if (!fast) return 'no fast switch on this model'
    fast.click()
    await new Promise(r => setTimeout(r, 700))
    const chip = document.querySelector('button[aria-label="Reasoning effort"]')
    return 'switch is now ' + fast.getAttribute('aria-checked')
      + ' || chip says: ' + (chip?.innerText.split(String.fromCharCode(10)).join(' ').trim() ?? '?')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The effort control on Cursor grok, which lists eight levels. No mission is sent; the panel is the subject.'
  })
}
