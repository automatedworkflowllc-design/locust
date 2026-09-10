// Three of the design agent's critique items, read off the built app.
//
//   LOCUST_SPEND=1 node _tools/probe-thread-rhythm.mjs
//
//   2. Lime meant "selected" AND "working". The role label was tinted whole.
//      -> while a run is live: the role span must be muted and only the state
//         span toned; the current mission row must sit on the neutral
//         selected ground, not the lime tint.
//   3. `Starting…` said twice, header and thread.
//      -> while a run is starting: the header's mission line must not say
//         Starting; the thread's `Starting · Ns` line is the one that stays.
//   4. Turns run together. Spec: 22px between turn groups, 12px within.
//      -> on a two-turn conversation: the rendered gap between the last
//         agent line of turn one and the user bubble of turn two, in pixels,
//         read off the boxes rather than off the stylesheet.
//
// SPENDS two short Claude Code turns on sonnet at low effort.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two Claude Code turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-rhythm-ws-')
const drive = await startDrive({
  name: 'thread-rhythm',
  port: 9466,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
})()`

const waitDone = `(async () => {
  for (let i = 0; i < 360; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  return 'done'
})()`

try {
  await drive.capture('send turn one and read the header and sidebar WHILE it starts and works', async () => {
    await drive.ready()
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()`)
    await new Promise((r) => setTimeout(r, 700))
    await drive.evaluate(send('In two short paragraphs, say what a cache is.'))
    return drive.evaluate(`(async () => {
      // Sample early and often: "starting" is a few hundred ms wide.
      const headerSaid = new Set()
      let metaRole = null, metaState = null, metaRoleColor = null, metaStateColor = null
      let rowBg = null, selectedBg = getComputedStyle(document.documentElement).getPropertyValue('--lc-bg-selected').trim()
      let limeTint = getComputedStyle(document.documentElement).getPropertyValue('--lc-lime-tint').trim()
      for (let i = 0; i < 120; i += 1) {
        await new Promise(r => setTimeout(r, 100))
        const line = document.querySelector('.lc-workroom__mission')?.innerText.replace(/\\\\s+/g, ' ').trim()
        if (line) headerSaid.add(line.slice(0, 40))
        const role = document.querySelector('.lc-teammate.is-selected .lc-row__metarole')
        const state = document.querySelector('.lc-teammate.is-selected .lc-row__metastate')
        if (role && state && metaRole === null) {
          metaRole = role.innerText.trim(); metaState = state.innerText.trim()
          metaRoleColor = getComputedStyle(role).color; metaStateColor = getComputedStyle(state).color
        }
        const row = document.querySelector('.lc-teammate__mission.is-active')
        if (row && rowBg === null) rowBg = getComputedStyle(row).backgroundColor
        if (i > 12 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      return JSON.stringify({
        headerEverSaidStarting: [...headerSaid].some(s => /^Starting/.test(s)),
        headerLinesSeen: [...headerSaid].slice(0, 4),
        meta: { role: metaRole, state: metaState, roleColor: metaRoleColor, stateColor: metaStateColor, sameColor: metaRoleColor === metaStateColor },
        currentRow: { background: rowBg, selectedToken: selectedBg, limeTint }
      }, null, 1)
    })()`)
  })

  await drive.evaluate(waitDone)

  await drive.capture('send turn two and measure the gap between the turns', async () => {
    await drive.evaluate(send('Now one sentence on cache invalidation.'))
    await drive.evaluate(waitDone)
    return drive.evaluate(`(() => {
      const column = document.querySelector('.lc-thread__column')
      if (!column) return 'no thread column'
      const items = [...column.children]
      const bubbles = items.filter(n => n.classList.contains('lc-bubble'))
      if (bubbles.length < 2) return 'fewer than two user bubbles: ' + bubbles.length
      const second = bubbles[1]
      // The last thing drawn before the second bubble, whatever it is.
      const before = items[items.indexOf(second) - 1]
      const gapBeforeBubble = Math.round(second.getBoundingClientRect().top - before.getBoundingClientRect().bottom)
      // And the gap INSIDE a turn: between the first bubble and what follows it.
      const first = bubbles[0]
      const after = items[items.indexOf(first) + 1]
      const gapWithinTurn = Math.round(after.getBoundingClientRect().top - first.getBoundingClientRect().bottom)
      return JSON.stringify({
        gapBetweenTurnsPx: gapBeforeBubble,
        beforeSecondBubble: before.className.slice(0, 40),
        gapWithinTurnPx: gapWithinTurn,
        afterFirstBubble: after.className.slice(0, 40),
        columnGap: getComputedStyle(column).gap
      }, null, 1)
    })()`)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet at low effort, two short turns. The header and sidebar are read while the first runs; the thread is measured after the second.'
  })
}
