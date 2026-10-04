// Walk the Settings screen top to bottom and keep a picture of each screenful.
//
//   node _tools/drive-settings.mjs
//
// For judging how Settings READS, not what it does: Colin, 2026-09-05, "the
// settings screen looks a little clunky". Seeded with one teammate on its
// own branch so every section has something in it.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository()
const drive = await startDrive({
  name: 'settings',
  port: 9293,
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

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Settings', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const heads = [...document.querySelectorAll('.lc-settings__heading')].map(h => h.textContent.trim())
    return heads.join(' / ')
  })()`))
  // Scroll the screen one viewport at a time until it stops moving.
  for (let i = 1; i <= 8; i += 1) {
    const moved = await drive.capture(`Settings screenful ${String(i + 1)}`, () => drive.evaluate(`(() => {
      const heading = document.querySelector('.lc-settings__heading')
      let box = heading
      while (box && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement
      if (!box) return 'no scroll box'
      const before = box.scrollTop
      box.scrollTop = before + box.clientHeight - 80
      return 'scrolled ' + String(box.scrollTop - before) + ' of ' + String(box.scrollHeight)
    })()`))
    if (/scrolled 0 /.test(String(moved)) || /no scroll box/.test(String(moved))) break
  }
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Two seeded teammates, one on its own branch. Settings, one screenful at a time.' })
}
