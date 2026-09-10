// Why does Stop do nothing on the second turn of a conversation?
//
//   LOCUST_SPEND=1 node _tools/probe-stop-on-a-follow-up.mjs
//
// Found by `probe-codex-streams` and then CONTROLLED on Claude Code, which
// had not changed transports: the FIRST turn of a conversation stops in 0s
// on both runtimes, and a later turn ignores the button and runs to
// completion (24.5s Codex, 23.5s Claude, both reaching 200 of 200).
//
// CAUSE, traced 2026-09-10: at the moment of the press the shown run was
// still keyed `pending:2` with no `data` -- six seconds after send, while the
// runtime was already streaming. `cancelMission` read the run id off that
// run, found none, and returned without a word. The composer draws the stop
// button for `starting` as well as `running`, so the box offered a control
// that could not work. A first turn resolves fast enough to hide it, which is
// why the button had passed every earlier drive.
//
// FIXED by remembering the press against the key the run has and cancelling
// the moment the host names it (`stopPress`). This is now the regression
// probe: the number that matters is `secondsToStop` on turn TWO.
//
// SPENDS two Claude Code turns on sonnet at low effort.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two Claude Code turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-stopfollow-ws-')
const drive = await startDrive({
  name: 'stop-on-a-follow-up',
  port: 9475,
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
  return true
})()`

const settle = `(async () => {
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1000))
  return true
})()`

try {
  await drive.capture('turn one: send, and stop it', async () => {
    await drive.ready()
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(send('Count slowly from 1 to 60, one number per line, with a sentence about each.'))
    await drive.evaluate(`new Promise(r => setTimeout(r, 6000))`)
    const pressed = await drive.evaluate(`(() => {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop === null) return false
      stop.click()
      return true
    })()`)
    const stopped = await drive.evaluate(`(async () => {
      for (let i = 0; i < 60; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) return i * 0.5
      }
      return 'still running after 30s'
    })()`)
    return JSON.stringify({ pressed, secondsToStop: stopped }, null, 1)
  })

  await drive.evaluate(settle)

  await drive.capture('turn two, the follow-up: send, and stop it the same way', async () => {
    await drive.evaluate(send('Now count slowly from 1 to 200, one number per line, with a sentence about each.'))
    await drive.evaluate(`new Promise(r => setTimeout(r, 6000))`)
    // What the box thinks is going on at the moment of the press.
    const before = await drive.evaluate(`JSON.stringify({
      stopButton: document.querySelector('button[aria-label^="Stop the running"]') !== null,
      stopDisabled: document.querySelector('button[aria-label^="Stop the running"]')?.disabled ?? null,
      header: (document.querySelector('.lc-workroom__line')?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120)
    })`)
    const pressed = await drive.evaluate(`(() => {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop === null) return false
      stop.click()
      return true
    })()`)
    const stopped = await drive.evaluate(`(async () => {
      for (let i = 0; i < 60; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) return i * 0.5
      }
      return 'still running after 30s'
    })()`)
    return JSON.stringify({
      before: JSON.parse(String(before)),
      pressed,
      secondsToStop: stopped
    }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet at low effort. Two turns of one conversation, each asked for a long answer and then stopped the same way; turn two is the one that used to ignore the button. (Wrapping `cancelCodexMission` was tried first and never took: contextBridge freezes what it exposes, so the property cannot be replaced -- the cause was traced with a temporary trace compiled into the renderer instead.)'
  })
}
