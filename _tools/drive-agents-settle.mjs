// How the agents settle after a launch, second by second (0.634).
//
//   node _tools/drive-agents-settle.mjs [--packaged <Locust.exe>] [--tag <name>] [--seconds N]
//
// The first screen no longer waits for the slowest agent's check
// (sweep-settle.ts): an agent still being checked at two seconds is shown so,
// and its answer is put in when it lands. This reads the sidebar's count of
// agents ready ("N AI agents ready", `.lc-connected`) once a second from the
// moment the app is on screen, so two builds can be set side by side: the
// count may start lower now, and must end where the older build's does --
// a slow agent shown "being checked" and then left there, or put down as
// signed out, would end lower. Sends nothing.

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'
import { join } from 'node:path'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const seconds = Number(arg('--seconds') ?? '25')

const drive = await startDrive({
  name: `agents-settle-${tag}`,
  port: 9934,
  workspace: await scratchRepository('locust-drive-agents-settle-ws-'),
  sendsNothing: true,
  outPath: join(recordRoot('agents-settle-2026-10-05'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

const READ = `(() => {
  const el = document.querySelector('.lc-connected')
  const title = el?.getAttribute('title') ?? ''
  const count = /^(\\d+) AI agent/.exec(title)?.[1]
  return JSON.stringify({ count: count === undefined ? null : Number(count), text: (el?.textContent ?? '').trim() })
})()`

let failures = 0
const series = []
try {
  await drive.capture('launch', () => drive.ready())
  for (let s = 0; s <= seconds; s += 1) {
    const got = JSON.parse(String(await drive.evaluate(READ)))
    series.push(got.count)
    if (s === 0 || s === 2 || s === 5 || s === 10 || s === seconds) say(`  ${String(s)} s after ready: ${JSON.stringify(got)}`)
    await sleep(1000)
  }
  const last = series.at(-1)
  say(`  series: ${series.map((c) => String(c)).join(' ')}`)
  say(`  RESULT first=${String(series[0])} last=${String(last)} max=${String(Math.max(...series.filter((c) => c !== null)))}`)
  if (last === null || last === undefined) failures += 1
  await drive.capture(`after ${String(seconds)} s`, async () => {})
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The agents ready count, once a second for ${String(seconds)} s after the app is on screen.`, extra: `Failures: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
