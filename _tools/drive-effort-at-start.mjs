// Does the starting route get its effort chip, and how long does it take?
//
//   node _tools/drive-effort-at-start.mjs
//
// drive-effort-regression read the composer about a second after the app was
// ready and found NO effort chip on Codex CLI / account-default -- though the
// picker lists four levels for that exact route. The model catalogue is an
// async read (it briefly starts an app-server), so the chip cannot exist
// before it lands. The question is whether it arrives at all, and how long a
// person stares at a composer with no effort control -- which is the exact
// shape of the complaint that started all of this.
//
// Spends nothing.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-effort-start-ws-')
const drive = await startDrive({
  name: 'effort-at-start',
  port: 9338,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const WATCH = `(async () => {
  const flat = (el) => el.innerText.split(/\s+/).join(' ').trim()
  const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Message Wren')
  if (open) open.click()
  await new Promise((r) => setTimeout(r, 400))
  const seen = []
  let appearedAt = null
  for (let i = 0; i < 60; i += 1) {
    const dock = document.querySelector('form.command-dock')
    const chip = dock ? [...dock.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Reasoning effort') : undefined
    const state = chip ? flat(chip) : 'absent'
    if (seen[seen.length - 1] !== state) seen.push(i + 's ' + state)
    if (chip && appearedAt === null) { appearedAt = i; break }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 'effort chip appeared at: ' + (appearedAt === null ? 'NEVER in 60s' : appearedAt + 's')
    + ' || trail: ' + seen.join(' -> ')
})()`

try {
  await drive.capture('how long until the starting route has an effort chip', async () => {
    await drive.ready()
    return drive.evaluate(WATCH)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Whether the default route ever gets its effort control, and how long that takes.' })
}
