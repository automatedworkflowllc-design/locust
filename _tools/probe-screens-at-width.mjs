// Do the other screens still hold at a wide window?
//
//   node _tools/probe-screens-at-width.mjs
//
// `--lc-thread-max-width` stopped being a constant on 2026-09-10 -- it now
// grows with the window -- and four rules share it: the update banner, the
// thread column, the teammate exchange and the composer. They are meant to
// move together, so this looks at each screen at 1920 and keeps the picture.
//
// SPENDS NOTHING.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-screens-ws-')
const drive = await startDrive({
  name: 'screens-at-width',
  port: 9481,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-05T05:01:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Whether anything on screen is wider than the window, which is the failure. */
const overflow = `(() => {
  const wide = [...document.querySelectorAll('*')].filter(
    (node) => node.getBoundingClientRect().right > window.innerWidth + 1
  )
  return JSON.stringify({
    window: window.innerWidth,
    somethingOverflows: wide.length,
    firstFew: wide.slice(0, 3).map((n) => n.className || n.tagName)
  }, null, 1)
})()`

const go = (label) => `(() => {
  const tab = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(label)})
  if (tab === undefined) return 'no ' + ${JSON.stringify(label)} + ' tab'
  tab.click()
  return 'opened'
})()`

try {
  await drive.ready()
  await drive.resize(1920, 1040)
  await drive.evaluate(`new Promise(r => setTimeout(r, 600))`)

  await drive.capture('home at 1920', async () => drive.evaluate(overflow))

  for (const screen of ['Team', 'Settings', 'Missions']) {
    await drive.capture(`${screen.toLowerCase()} at 1920`, async () => {
      await drive.evaluate(go(screen))
      await drive.evaluate(`new Promise(r => setTimeout(r, 600))`)
      return drive.evaluate(overflow)
    })
  }

  await drive.capture('the room form at 1920', async () => {
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => /New room/.test(b.innerText))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 600))`)
    return drive.evaluate(overflow)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Nothing is sent. Each screen is opened at 1920x1040 and checked for anything reaching past the window edge.'
  })
}
