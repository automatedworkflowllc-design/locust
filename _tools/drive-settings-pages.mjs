// Every page of Settings, one frame each.
//
//   node _tools/drive-settings-pages.mjs
//
// `drive-settings.mjs` scrolls the page it lands on and stops there. Settings
// has had a sub-nav since 0.212 -- Your workspace / Runtimes / How teammates
// work / Appearance / This app -- so four of its five pages had never been
// captured by anything, which is part of why the 2026-09-21 design handover
// could only diagnose the one screen it could see.
//
// Appearance matters most of the four: it carries three segmented controls
// and the memory switch, so it is where a change to the shared row and
// segmented rules shows up worst if it is wrong.
//
// Costs nothing: no mission is started.

import { FREE_ROUTE, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository()
const drive = await startDrive({
  name: 'settings-pages',
  port: 9294,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE, worktree: true },
      { teammateId: 'tm_ada', name: 'Ada', hue: 'blue', role: 'Custom', roleTitle: 'Release manager', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'auto' }
  }
})

const PAGES = ['Your workspace', 'Runtimes', 'How teammates work', 'Appearance', 'This app']

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Settings', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    return [...document.querySelectorAll('.lc-settings__navitem')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')
  })()`))

  for (const page of PAGES) {
    await drive.capture(page, () => drive.evaluate(`(async () => {
      const item = [...document.querySelectorAll('.lc-settings__navitem')]
        .find(n => n.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(page)}))
      if (!item) return 'no nav item named ' + ${JSON.stringify(page)}
      item.click()
      await new Promise(r => setTimeout(r, 700))
      const pane = document.querySelector('.lc-settings__pane')
      return JSON.stringify({
        headings: [...document.querySelectorAll('.lc-settings__heading')].map(h => h.textContent.trim()),
        // What the row and segmented rules actually produced, measured rather
        // than eyeballed: a row shorter than its own minimum, or a segmented
        // button still at full button height, is the failure to catch.
        rowHeights: [...document.querySelectorAll('.lc-settingrow')].map(r => Math.round(r.getBoundingClientRect().height)),
        segmentedHeights: [...document.querySelectorAll('.lc-segmented > button')].map(b => Math.round(b.getBoundingClientRect().height)),
        // A card inside a card draws two borders a pixel apart.
        nestedCards: document.querySelectorAll('.lc-settingrows .lc-settingrows, .lc-settingrows .lc-settingcard').length,
        paneScrolls: pane ? pane.scrollHeight > pane.clientHeight + 4 : null
      })
    })()`))
  }
} finally {
  await drive.finish({
    intro: 'Every page of the Settings sub-nav, one frame each, plus measured row and segmented-button heights.'
  })
}
