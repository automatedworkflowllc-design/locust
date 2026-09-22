// Returning to the window asks only about the runtimes that are not ready.
//
//   node _tools/probe-focus-asks-only-the-unready.mjs
//
// Main-process audit, 2026-09-22: one signed-out CLI made every return to the
// window a FULL sweep -- ~16 processes on each alt-tab, all session. Now the
// window names the runtimes it is waiting on and the host asks only those.
//
// Read from the discovery log ONLY, which reading does not change: a full
// sweep starts a new log (a new `started` time) and a named re-ask appends a
// `reasked` entry. The first version of this probe asked the host for its
// answer to compare -- and that ask started a sweep of its own, which then
// served the window's re-ask from cache: the measurement fed itself.
//
// Signed-out runtimes come from the same trick as drive-install-or-sign-in:
// empty APPDATA (Cursor reads signed out) and empty XDG_CONFIG_HOME (Muse
// reads signed out). Spends nothing: no mission is sent.

import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

// `--packaged` drives the last release instead of out/: the CONTROL, which on
// a build from before 2026-09-22 must fail -- it swept everything on focus.
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const packaged = process.argv.includes('--packaged') && existsSync(EXE) ? EXE : undefined
say(packaged === undefined ? 'driving the LOCAL build in out/' : 'driving the PACKAGED build')

const drive = await startDrive({
  name: 'focus-asks-only-the-unready',
  port: 9352,
  workspace: await scratchRepository('locust-focus-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  env: {
    APPDATA: await mkdtemp(join(tmpdir(), 'locust-focus-appdata-')),
    XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'locust-focus-config-'))
  },
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

const failures = []
const STATE = `(async () => {
  const log = await window.desktop.discoveryLog()
  const started = log.find(e => e.kind === 'started')
  return JSON.stringify({
    sweepStartedAt: started ? started.at : null,
    reasked: log.filter(e => e.kind === 'reasked').map(e => e.ids.join('+'))
  })
})()`
try {
  const before = JSON.parse(await drive.capture('launch, with runtimes signed out', async () => {
    await drive.ready()
    /*
     * Past the window's OWN re-ask at 15 s and the ten-second gap after it.
     * The first version of this probe waited 11.5 s after ready, landed its
     * focus 2.8 s after that 15 s re-ask, and read the gap doing its job as
     * "asked nothing" -- a timeline of the log settled it.
     */
    await sleep(27_000)
    return drive.evaluate(STATE)
  }))

  const after = JSON.parse(await drive.capture('return to the window', async () => {
    await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
    await sleep(6_000)
    return drive.evaluate(STATE)
  }))
  if (after.sweepStartedAt !== before.sweepStartedAt) failures.push('returning to the window ran a FULL sweep')
  else if (after.reasked.length === before.reasked.length) failures.push('returning to the window asked nothing at all')
  say(`before: ${JSON.stringify(before)}`)
  say(`after:  ${JSON.stringify(after)}`)
} finally {
  await drive.finish({ intro: 'Build: out/. Cursor and Muse signed out by empty APPDATA / XDG_CONFIG_HOME. A focus must re-ask, and must not sweep everything.' })
}
for (const failure of failures) say(`[FAIL] ${failure}`)
if (failures.length === 0) say('[PASS] a return to the window asked again, and only about what was not ready')
process.exitCode = failures.length === 0 ? 0 : 1
