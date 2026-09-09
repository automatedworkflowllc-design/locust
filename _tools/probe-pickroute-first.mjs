// Does `pickRouteScript` work when it is the FIRST thing to touch the picker?
//
//   node _tools/probe-pickroute-first.mjs
//   node _tools/probe-pickroute-first.mjs --dev
//
// `probe-picker-contents` found the helper reporting success while leaving the
// route chip on Codex -- on both builds. That would put every route claim in
// roughly sixty drives in doubt, so it is worth being exact about before
// saying it.
//
// The difference between that probe and a real drive is sequencing: the probe
// had already opened the picker and typed a search three steps earlier, and
// real drives call the helper as their first picker interaction on a freshly
// opened teammate. React does not re-fire onChange when an input is set to the
// value it already holds, so a stale search box is a plausible cause -- and if
// that is the cause, the sixty drives are fine and only the probe was wrong.
//
// This does exactly what a real drive does, and nothing else. No mission is
// started, so it costs nothing.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const DEV = process.argv.includes('--dev')
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!DEV && !existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}
say(DEV ? 'probing the DEV build' : 'probing the PACKAGED build')

const workspace = await scratchRepository('locust-pickfirst-ws-')
const drive = await startDrive({
  name: DEV ? 'pickroute-first-dev' : 'pickroute-first',
  port: DEV ? 9426 : 9425,
  ...(DEV ? {} : { packaged: EXE }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const CHIP = `(() => {
  const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
  return (c?.textContent ?? '').trim()
})()`

try {
  await drive.capture('open a teammate, then pick a route as a real drive does', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    const before = String(await drive.evaluate(CHIP))
    // The helper's own retry loop waits up to 30s for the picker and its rows,
    // so no separate catalog wait is needed here -- which is exactly how the
    // real drives call it.
    const said = String(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
    const after = String(await drive.evaluate(CHIP))
    return JSON.stringify({
      before,
      after,
      switched: /opencode/i.test(after),
      helperSaid: said.slice(0, 160)
    })
  })

  await drive.capture('and a second call, to a different runtime', async () => {
    // If the first works and the second does not, the fault is a stale search
    // box rather than the helper as such -- which is the shape that would
    // leave most existing drives sound.
    const said = String(await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok', row: '/grok/i' })))
    const after = String(await drive.evaluate(CHIP))
    return JSON.stringify({ after, switched: /cursor/i.test(after), helperSaid: said.slice(0, 160) })
  })
} finally {
  await drive.finish({ intro: 'Calling pickRouteScript the way a real drive calls it. Nothing is sent to a model.' })
}

say('done')
