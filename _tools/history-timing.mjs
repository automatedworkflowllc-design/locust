// How long the history read takes on a REAL ledger, inside the app.
//
//   node _tools/history-timing.mjs [--ledger <dir>] [--runs N]
//
// Every run that ends, and the first click on a finished conversation, asks
// the host for the whole mission history; the renderer audit (2026-09-22)
// measured the read OUTSIDE Electron at 620-670 ms with a 164-210 ms stall.
// This measures it where it happens: the app, a copy of the real ledger,
// and a cheap ping sent while the read runs -- the ping's delay is the
// main process being unable to answer anybody else.
//
// The ledger is COPIED into a throwaway profile and the copy is deleted
// afterwards; nothing is sent anywhere and no mission is started.

import { cp, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}
const source = arg('--ledger') ?? join(homedir(), 'AppData', 'Roaming', '@teammate', 'desktop', 'mission-ledger')
const runs = Number(arg('--runs') ?? '5')

const profile = await mkdtemp(join(tmpdir(), 'locust-history-timing-'))
await cp(source, join(profile, 'mission-ledger'), { recursive: true })
const drive = await startDrive({
  name: 'history-timing',
  port: 9355,
  profilePath: profile,
  workspace: await scratchRepository('locust-history-ws-'),
  sendsNothing: true,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
try {
  await drive.ready()
  await sleep(3000)
  for (let run = 1; run <= runs; run += 1) {
    const measured = JSON.parse(await drive.evaluate(`(async () => {
      const t0 = performance.now()
      const history = window.desktop.getMissionHistory()
      // A cheap ask, 20 ms into the read: how long until the host answers it.
      await new Promise(r => setTimeout(r, 20))
      const p0 = performance.now()
      await window.desktop.discoveryLog()
      const ping = performance.now() - p0
      const answer = await history
      const total = performance.now() - t0
      const bytes = JSON.stringify(answer).length
      const missions = answer.ok ? answer.data.missions.length : -1
      const withEvents = answer.ok ? answer.data.missions.filter(m => m.events.length > 0).length : -1
      return JSON.stringify({ total: Math.round(total), ping: Math.round(ping), bytes, missions, withEvents })
    })()`))
    say(`run ${String(run)}: history ${String(measured.total)} ms · ping answered after ${String(measured.ping)} ms · ${(measured.bytes / 1e6).toFixed(2)} MB · ${String(measured.missions)} missions, ${String(measured.withEvents)} with events`)
    await sleep(500)
  }
} finally {
  await drive.finish({ intro: 'History read timing on a copy of the real ledger.' })
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
