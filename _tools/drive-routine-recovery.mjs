// A multi-step routine, force-quit mid-flight, and the app opened again.
//
//   node _tools/drive-routine-recovery.mjs
//
// The recovery work (Astra, 2026-09-08) is covered by 17 tests, and its own
// report names the gap honestly: "Installed Electron restart/click-through
// with real runtimes was not run." That is the whole subject of the feature --
// what a person sees after a restart -- and it had never been done in a real
// restart. Every test uses doubles for the host and server-renders the UI.
//
// So: a real two-step routine on a free model, a real force-quit while step 1
// is running, a real relaunch on the same profile, and a look at the screen.
//
// The kill is `child.kill()` on Electron, like `drive-interrupted.mjs` -- no
// `before-quit`, no graceful flush. A recovery that only works when the app
// was closed politely is not one.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-recovery-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

let drive = await startDrive({ name: 'routine-recovery', port: 9397, workspace, seed, keep: true })
let handoff

/** What the Automations screen says, in the words a person would read. */
const automations = `(async () => {
  document.querySelector('button[title*="Automations"], button[aria-label*="Automations"]')?.click()
  const link = [...document.querySelectorAll('button, a')].find(n => /automations/i.test(n.textContent ?? ''))
  if (link) link.click()
  await new Promise(r => setTimeout(r, 1200))
  const screen = document.querySelector('.lc-screen, main')?.innerText.replace(/[ \\t]+/g, ' ').trim() ?? 'no screen'
  return JSON.stringify({
    saysHeld: /held|interrupted|waiting|needs you|review/i.test(screen),
    hasContinue: [...document.querySelectorAll('button')].some(b => /continue/i.test(b.textContent ?? '')),
    hasAbandon: [...document.querySelectorAll('button')].some(b => /abandon|discard|stop/i.test(b.textContent ?? '')),
    claimsANextRun: /next \\d\\d:\\d\\d|next tomorrow|due now/i.test(screen),
    screen: screen.slice(0, 700)
  }, null, 1)
})()`

try {
  await drive.capture('launch and teach a two-step routine', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  // Seeded rather than taught through the UI: teaching a routine is a
  // different feature with its own drive, and what is being tested here is
  // the restart. The shape is the store's own, so a receipt this cannot
  // produce is a receipt the store would reject.
  await drive.capture('write a two-step routine the way the store stores one', () => drive.evaluate(`(async () => {
    const bridge = window.desktop
    const saved = await bridge.createRoutine({
      name: 'Two step check',
      teammateId: 'tm_wren',
      route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', mode: 'accept-edits' },
      steps: ['Count slowly from 1 to 40, one number per line, then say done.', 'Say the word FINISHED.'],
      learnedFrom: []
    })
    return JSON.stringify(saved).slice(0, 300)
  })()`))

  await drive.capture('run it, and be mid-step-one', () => drive.evaluate(`(async () => {
    const list = await window.desktop.listRoutines()
    const id = list?.data?.routines?.[0]?.routineId ?? list?.routines?.[0]?.routineId
    if (id === undefined) return 'no routine to run: ' + JSON.stringify(list).slice(0, 200)
    void window.desktop.runRoutine(id)
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'step 1 is running'
    }
    return 'never saw a run start'
  })()`))

  handoff = await drive.finish({
    intro: 'A two-step routine, force-quit during step 1, then opened again. The recovery feature has 17 tests and had never been restarted for real.',
    last: false
  })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  const onDisk = JSON.parse(await readFile(join(handoff.profile, 'routines.json'), 'utf8'))
  say(`execution on disk after the kill: ${JSON.stringify(onDisk.routines?.[0]?.execution ?? 'NONE')}`)

  drive = await startDrive({
    name: 'routine-recovery',
    port: 9397,
    workspace,
    profilePath: handoff.profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  await drive.capture('opened again: does anything say the routine was cut off', async () => {
    await drive.ready()
    // Past the first scheduled tick, so a routine that was going to replay
    // itself has had its chance to.
    await drive.evaluate(`new Promise(r => setTimeout(r, 20000))`)
    return drive.evaluate(automations)
  })

  await drive.capture('and it did NOT quietly run the rest', () => drive.evaluate(`(async () => {
    // The policy is (c): ask. A step that started itself on relaunch would be
    // the opposite of the decision, and the one outcome worth failing over.
    const running = document.querySelector('button[aria-label^="Stop the running"]') !== null
    const list = await window.desktop.listMissions?.().catch(() => undefined)
    return 'a run is active: ' + running + (list === undefined ? '' : ' || missions: ' + (list?.data?.missions?.length ?? 'unknown'))
  })()`))
} finally {
  if (drive !== undefined) {
    await drive.finish({ intro: 'The relaunch half.' })
  }
}

say('done')
