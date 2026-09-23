// Delete a mission that is still running, and delete a long conversation.
//
//   node _tools/probe-delete-live.mjs
//
// "deleted a mission doesn't work as well" -- the first outside tester, on
// 0.55.0. This is the THIRD report of delete not working: the sidebar row
// once removed the last turn and left the row, and a refusal asked for from
// the sidebar once reported nothing anywhere.
//
// probe-delete-mission.mjs already shows the ordinary case works -- run a
// mission, let it finish, press Delete twice, and the record goes. So this
// takes the two paths that one does not:
//
//   1. Delete while the mission is RUNNING. The host refuses it, on purpose.
//      The question is whether the person is told, or whether the button
//      simply eats the click.
//   2. Delete a conversation of several turns, which is more than one mission
//      record behind one row.
//
// FREE: short runs on the free OpenCode model, read-only.

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-delete-live-ws-')
const drive = await startDrive({
  name: 'delete-live',
  port: 9442,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text, wait) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  if (!${String(wait)}) {
    // Waits for the run to actually be LIVE rather than for a fixed moment.
    // 2.5 seconds was not enough on a cold start, and the probe then refused
    // its own premise -- correctly, but for the wrong reason.
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'live after ' + (i * 250) + 'ms'
    }
    return 'never went live'
  }
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1000))
  return 'finished'
})()`)

/** Press Delete twice, and say what the screen said about it. */
const pressDelete = () => drive.evaluate(`(async () => {
  const first = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Delete')
  if (!first) return 'no Delete button on screen'
  first.click()
  await new Promise(r => setTimeout(r, 400))
  const armed = [...document.querySelectorAll('button')].find(b => /Delete for good/.test(b.innerText))
  if (!armed) return 'first click did not arm it'
  armed.click()
  await new Promise(r => setTimeout(r, 1500))
  const alert = document.querySelector('[role=alert]')?.innerText.replace(/\\s+/g, ' ').trim()
  return 'conversations: ' + document.querySelectorAll('.lc-teammate__mission').length +
    ' · said: ' + (alert && alert.length > 0 ? alert : 'NOTHING') +
    ' · still running: ' + (document.querySelector('button[aria-label^="Stop the running"]') !== null)
})()`)

try {
  // ready() first: it waits for discovery. Without it the composer still
  // reads "No runtime on this machine can run a mission yet" -- true at that
  // instant -- and the send goes nowhere, which this probe then reported as
  // the run never going live.
  await drive.capture('launch and open Wren', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 200))
    const open = ${teammateFace('Wren')}
    if (open) open.click()
    await new Promise(r => setTimeout(r, 500))
    return 'opened'
  })()`)
  })

  await drive.capture('start a long run and leave it going', () => send('Count from 1 to 2000. Put each number on its own line, in order, with no other text. Do not stop early.', false))

  // The premise, outside capture(): if the run already ended there is no
  // live mission to refuse, and the step below would report the ordinary
  // delete working rather than the case it is for.
  const live = await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]') !== null`)
  if (live !== true) throw new Error('NOT A LIVE DELETE TEST: nothing is running, so nothing can be refused')
  say('  a run is live')

  await drive.capture('press Delete while it runs: is the refusal said', () => pressDelete())

  await drive.capture('stop it, then delete: does it go now', async () => {
    await drive.evaluate(`(async () => {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) stop.click()
      for (let i = 0; i < 60; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      await new Promise(r => setTimeout(r, 1500))
      return 'stopped'
    })()`)
    return pressDelete()
  })

  await drive.capture('a conversation of three turns', async () => {
    await drive.evaluate(`(async () => {
      const open = ${teammateFace('Wren')}
      if (open) open.click()
      await new Promise(r => setTimeout(r, 500))
      return 'opened'
    })()`)
    for (const word of ['ALPHA', 'BETA', 'GAMMA']) {
      await send(`Reply with exactly one word: ${word}. Nothing else.`, true)
    }
    return drive.evaluate(`'conversations: ' + document.querySelectorAll('.lc-teammate__mission').length + ' · turns on screen: ' + document.querySelectorAll('.lc-thread__marker').length`)
  })

  await drive.capture('delete it: every turn, or just the last one', () => pressDelete())

  await drive.capture('what the missions screen has left', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    return 'rows: ' + document.querySelectorAll('.lc-missionrow').length + ' || ' + (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on the free OpenCode model, read-only. Delete pressed while a run is live, after stopping it, and on a conversation of three turns.' })
}
