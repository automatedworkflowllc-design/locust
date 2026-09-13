// Does the effort slider agree with the word above it?
//
//   node _tools/probe-effort-knob-agrees.mjs
//
// Colin, 2026-09-11, with a screenshot: the panel reads `EFFORT high`, the
// knob sits hard LEFT against "Faster", and the description under it says
// "slower, costlier". Three statements about one value, and two of them
// cannot both be true.
//
// The suspect is one expression: `Math.max(0, effortBases.indexOf(base))`
// turns "this level is not on the scale" into "this level is the lowest one",
// silently. What it does NOT say is WHY the level is off the scale, and that
// is the part worth measuring rather than guessing: the catalog may be
// missing, the family lookup may be resolving elsewhere, or the stored route
// may carry a level this model never listed.
//
// SPENDS NOTHING. No mission is sent; this opens a popover and reads it.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-effort-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'effort-knob-agrees',
  port: 9499,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_yurt',
        name: 'Yurt',
        hue: 'blue',
        role: 'Code & Migrations',
        createdAt: now,
        // Exactly Colin's route: the family name, with the effort beside it.
        route: { runtime: 'cursor', model: 'cursor-grok-4.6-high', mode: 'accept-edits' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

// No backticks inside these template literals.
const read = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Yurt/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 900))
  // The chip is a BUTTON with that label; the panel it opens is a div with
  // the same one, which is why finding it by label alone found nothing.
  const chip = [...document.querySelectorAll('button[aria-label=\"Reasoning effort\"]')][0]
  if (chip === undefined) {
    return JSON.stringify({
      controls: [...document.querySelectorAll('.lc-control')].map(n => n.innerText.split(/\\s+/).join(' ').trim()),
      labelled: [...document.querySelectorAll('[aria-label]')].map(n => n.tagName + ':' + n.getAttribute('aria-label')).slice(0, 30)
    }, null, 1)
  }
  const chipSaid = chip.innerText.replace(/\\s+/g, ' ').trim()
  chip.click()
  await new Promise(r => setTimeout(r, 500))
  const panel = document.querySelector('.lc-effortpanel')
  if (panel === null) return JSON.stringify({ chipSaid, panel: 'did not open' })
  const slider = panel.querySelector('.lc-effortpanel__slider')
  const notches = panel.querySelectorAll('.lc-effortpanel__notch')
  const track = slider?.getBoundingClientRect()
  return JSON.stringify({
    chipSaid,
    headSaid: panel.querySelector('.lc-effortpanel__now')?.innerText.trim() ?? 'none',
    description: panel.querySelector('.lc-effortpanel__what')?.innerText.trim() ?? 'none',
    footer: panel.querySelector('.lc-menu__foot')?.innerText.trim() ?? 'none',
    notchCount: notches.length,
    notchesPassed: [...notches].filter(n => n.className.includes('is-passed')).length,
    sliderValue: slider === null ? 'no slider' : slider.value,
    sliderMax: slider === null ? 'no slider' : slider.max,
    sliderDisabled: slider === null ? 'no slider' : slider.disabled,
    // Where the knob actually SITS, as a fraction of the track. The number
    // Colin can see, independent of any of the above.
    knobFraction: slider === null || track === undefined || Number(slider.max) === 0
      ? null
      : Math.round((Number(slider.value) / Number(slider.max)) * 100)
  }, null, 1)
})()`

try {
  await drive.capture('the effort panel, on a Cursor route set to high', async () => {
    await drive.ready()
    return drive.evaluate(read)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One Cursor teammate seeded on `cursor-grok-4.6` at effort `high` — Colin’s exact route. The knob, the word above it and the description under it must all say the same thing.'
  })
}
