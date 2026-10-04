// What streaming costs the window: three teammates writing long replies at once.
//
//   node _tools/probe-streaming-cost.mjs --packaged <exe> --tag <name>
//
// Sol's optimization check (2026-10-02) found two mechanisms -- the run map
// copied once per streamed fragment, and the settled part of a reply parsed
// again every frame -- and measured neither in the app. This measures the
// app: from the first send until all three replies end, Chromium's own
// counters for script, layout, style and task time, and every long task
// (over 50 ms), divided by the characters that arrived. OpenCode's free
// model, so it spends nothing. A model's speed varies run to run, so compare
// builds ALTERNATELY (old, new, old, new), never one before the other.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const NAMES = ['Ada', 'Bo', 'Cy']
const ASK = 'Write about 700 words on how lighthouses were kept running before electricity. '
  + 'Use three headings, a bulleted list of at least five items, one short fenced code block, '
  + 'and some bold text. Do not read or write any files.'

const workspace = await scratchRepository('locust-probe-stream-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `streaming-cost-${tag}`,
  port: 9862,
  workspace,
  outPath: join(recordRoot('streaming-cost-2026-10-02'), tag),
  seed: {
    schemaVersion: 1,
    teammates: NAMES.map((name, index) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue: ['blue', 'lime', 'violet'][index], role: 'Custom', roleTitle: 'Writer', createdAt: '2026-10-02T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', mode: 'ask' } })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'no send'
})()`)
const running = async () => Boolean(await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`))
const metrics = async () => Object.fromEntries((await drive.send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]))

let failed = false
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.send('Performance.enable')
  // Wait for the route, as the round trip does.
  await drive.evaluate(openTeammateScript(NAMES[0]))
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? ''`))
    if (/opencode/i.test(route)) break
  }
  await drive.evaluate(`window.__long = []; new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(e.duration) }).observe({ type: 'longtask', buffered: false })`)
  // Twenty idle seconds first: what the window costs doing nothing, so the
  // stream's own cost can be told from animation that runs regardless.
  const idle0 = await metrics()
  await sleep(20_000)
  const idle1 = await metrics()
  const idleScriptPerSec = Math.round(((idle1.ScriptDuration - idle0.ScriptDuration) * 1000) / 20)
  const idleTaskPerSec = Math.round(((idle1.TaskDuration - idle0.TaskDuration) * 1000) / 20)
  // LOCUST_PROFILE=1: a CPU profile of the stream, and the functions that took the most of it.
  const profiling = process.env.LOCUST_PROFILE === '1'
  if (profiling) {
    await drive.send('Profiler.enable')
    await drive.send('Profiler.setSamplingInterval', { interval: 500 })
    await drive.send('Profiler.start')
  }
  const before = await metrics()
  const began = Date.now()
  for (const name of NAMES) {
    await drive.evaluate(openTeammateScript(name))
    await sleep(800)
    say(`${name}: ${String(await send(ASK))}`)
  }
  // Watch the last one stream, then each in turn until none runs.
  for (const name of [...NAMES].reverse()) {
    await drive.evaluate(openTeammateScript(name))
    await sleep(800)
    for (let second = 0; second < 300 && (await running()); second += 1) await sleep(1000)
  }
  const after = await metrics()
  if (profiling) {
    const { profile } = (await drive.send('Profiler.stop')).result
    await writeFile(join(drive.out, 'stream.cpuprofile'), JSON.stringify(profile))
    const self = new Map()
    const byId = new Map(profile.nodes.map((node) => [node.id, node]))
    const counts = new Map()
    for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1)
    const total = profile.samples.length
    for (const [id, count] of counts) {
      const frame = byId.get(id).callFrame
      const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${String(frame.lineNumber + 1)}`
      self.set(key, (self.get(key) ?? 0) + count)
    }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)
    for (const [key, count] of top) say(`PROFILE ${(100 * count / total).toFixed(1)}% ${key}`)
  }
  const seconds = (Date.now() - began) / 1000
  let chars = 0
  for (const name of NAMES) {
    await drive.evaluate(openTeammateScript(name))
    await sleep(800)
    chars += Number(await drive.evaluate(`[...document.querySelectorAll('.lc-thread .lc-agentline__body')].reduce((n, el) => n + el.innerText.length, 0)`))
    if (name === NAMES[0]) await drive.capture(`${name} after`, async () => undefined)
  }
  const long = await drive.evaluate('window.__long')
  const d = (key) => after[key] - before[key]
  const per10k = (value) => (chars === 0 ? NaN : (value * 1000 * 10000) / chars)
  const row = {
    tag, seconds: Math.round(seconds), chars,
    idleScriptMsPerSec: idleScriptPerSec, idleTaskMsPerSec: idleTaskPerSec,
    scriptMsPerSec: Math.round((d('ScriptDuration') * 1000) / seconds), taskMsPerSec: Math.round((d('TaskDuration') * 1000) / seconds),
    scriptMsPer10k: Math.round(per10k(d('ScriptDuration'))),
    layoutMsPer10k: Math.round(per10k(d('LayoutDuration'))),
    styleMsPer10k: Math.round(per10k(d('RecalcStyleDuration'))),
    taskMsPer10k: Math.round(per10k(d('TaskDuration'))),
    longTasks: long.length,
    longestMs: Math.round(Math.max(0, ...long)),
    longMsTotal: Math.round(long.reduce((a, b) => a + b, 0))
  }
  say(`RESULT ${JSON.stringify(row)}`)
  if (chars < 3000) { failed = true; say('too little arrived to measure') }
} catch (error) {
  failed = true
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Three teammates on OpenCode's free model, long replies at once.` })
}
process.exit(failed ? 1 : 0)
