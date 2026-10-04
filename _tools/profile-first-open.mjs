// What the FIRST open of a teammate builds, and for how long (bug 3, lead 1).
//
//   node _tools/profile-first-open.mjs [--packaged <exe>] [--tag <name>] [--interval 100] [--settle 6000] [--no-resize]
//
// profile-four-runs (10/04) found the idle window's cost was not the runs:
// the first click on each teammate took 0.8-1.2 s to its second frame, the
// second click 20-30 ms. This seeds four teammates, sends nothing, and clicks
// Wren, Booty (first opens), Wren, Booty (second opens), Gem, Atlas (first
// opens again), taking ONE CPU profile per click so each profile's samples
// belong to that click alone. Per click: time to the second frame, longest
// frame gap and long tasks in the 1.2 s after, and the heaviest functions by
// self time. Costs nothing and runs nothing.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const interval = Number(arg('--interval') ?? 100)
// How long to let the launch settle before the first click (default 6 s), and whether to resize first:
// the four-runs drive clicked right after ready + resize and paid 0.8-1.2 s; with 6 s of settle a first open costs 7-25 ms.
const settle = Number(arg('--settle') ?? 6000)
const resize = !process.argv.includes('--no-resize')
const TEAM = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations' },
  { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA' },
  { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs' },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Code & Migrations' }
]
const CLICKS = [
  ['Wren', 'first'], ['Booty', 'first'], ['Wren', 'second'], ['Booty', 'second'], ['Gem', 'first'], ['Atlas', 'first'], ['Gem', 'second']
]
const workspace = await scratchRepository('locust-drive-first-open-ws-')
const out = join(recordRoot('first-open-2026-10-04'), tag)
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `first-open-${tag}`,
  port: 9853,
  workspace,
  outPath: out,
  sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: TEAM.map((one, i) => ({ ...one, createdAt: `2026-09-05T05:00:0${String(i)}.000Z` })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }

const clickAndMeasure = (name) => `(async () => {
  const face = ${teammateFace(name)}
  if (!face) return JSON.stringify({ missing: ${JSON.stringify(name)} })
  window.__gaps = []; window.__tasks = []
  let previous
  let on = true
  const frame = (now) => { if (previous !== undefined) window.__gaps.push(now - previous); previous = now; if (on) requestAnimationFrame(frame) }
  requestAnimationFrame(frame)
  let observer
  try { observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__tasks.push(Math.round(entry.duration)) }); observer.observe({ type: 'longtask', buffered: false }) } catch {}
  const at = performance.now()
  const hiddenBefore = document.hidden
  const focusBefore = document.hasFocus()
  face.click()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const painted = performance.now() - at
  await new Promise((r) => setTimeout(r, 1200))
  on = false
  observer?.disconnect()
  return JSON.stringify({
    name: ${JSON.stringify(name)}, sinceLoad: Math.round(at), hidden: hiddenBefore, focus: focusBefore, painted: Math.round(painted), maxGap: Math.round(Math.max(0, ...window.__gaps)), gapsOver50: window.__gaps.filter((gap) => gap > 50).map(Math.round),
    tasks: window.__tasks, canvases: document.querySelectorAll('canvas').length, threadNodes: document.querySelector('.lc-thread')?.querySelectorAll('*').length ?? 0,
    screen: document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80) ?? ''
  })
})()`

/** The heaviest functions by self time in one profile. */
function heaviest(profile, top = 14) {
  if (!profile?.nodes) return []
  const self = new Map()
  const perSample = (profile.endTime - profile.startTime) / Math.max(1, profile.samples?.length ?? 1)
  for (const node of profile.nodes) {
    const frame = node.callFrame ?? {}
    const url = String(frame.url ?? '').split(/[\\/]/).pop() ?? ''
    const key = `${frame.functionName || '(anonymous)'} ${url}${frame.lineNumber !== undefined && frame.lineNumber >= 0 ? `:${String(frame.lineNumber + 1)}:${String((frame.columnNumber ?? 0) + 1)}` : ''}`
    self.set(key, (self.get(key) ?? 0) + (node.hitCount ?? 0) * perSample / 1000)
  }
  return [...self.entries()].filter(([key]) => !/^\((idle|program|root)\)/.test(key)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([key, ms]) => `${String(Math.round(ms)).padStart(5)} ms  ${key}`)
}

const results = []
try {
  await drive.ready()
  if (resize) await drive.resize(1400, 900)
  const rostered = Number(await drive.evaluate(`document.querySelectorAll('.lc-faces__one').length`))
  if (rostered !== 4) throw new Error(`roster holds ${String(rostered)} teammates, not 4`)
  // Let the launch settle (or not: --settle 0 measures the clicks a person makes straight away).
  if (settle > 0) await sleep(settle)
  note(`settle ${String(settle)} ms, resize ${resize ? 'yes' : 'no'}`)
  // The frame cadence from ready() on: two frames in a row, timed, until they come 60 Hz
  // apart or 15 s pass. A window held behind the splash paints at 1 Hz; this says when it was shown.
  const cadence = JSON.parse(String(await drive.evaluate(`(async () => {
    const from = performance.now()
    const seen = []
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const two = performance.now() - t0
      seen.push(Math.round(two))
      if (two < 100 || performance.now() - from > 15000) break
    }
    return JSON.stringify({ sinceLoadAtStart: Math.round(from), waited: Math.round(performance.now() - from), twoFrames: seen, hidden: document.hidden, focus: document.hasFocus() })
  })()`)))
  note(`frame cadence after ready(): ${JSON.stringify(cadence)}`)
  await drive.send('Profiler.enable')
  await drive.send('Profiler.setSamplingInterval', { interval })
  for (const [name, kind] of CLICKS) {
    await drive.send('Profiler.start')
    const one = JSON.parse(String(await drive.evaluate(clickAndMeasure(name))))
    const stopped = await drive.send('Profiler.stop')
    const profile = stopped?.result?.profile
    const hot = heaviest(profile)
    results.push({ kind, ...one, hot })
    note(`${kind} open of ${name} at +${String(one.sinceLoad)} ms (hidden ${String(one.hidden)}, focus ${String(one.focus)}): painted ${String(one.painted)} ms, max gap ${String(one.maxGap)} ms, gaps>50 ${JSON.stringify(one.gapsOver50)}, long tasks ${JSON.stringify(one.tasks)}, canvases ${String(one.canvases)}`)
    if (profile !== undefined) await writeFile(join(out, `${kind}-${name.toLowerCase()}.cpuprofile`), JSON.stringify(profile), 'utf8').catch(() => undefined)
    if (kind === 'first') note(`  heaviest:\n    ${hot.join('\n    ')}`)
    await sleep(700)
  }
  const firsts = results.filter((one) => one.kind === 'first')
  const seconds = results.filter((one) => one.kind === 'second')
  const sum = (rows) => `painted ${rows.map((one) => one.painted).join('/')} ms, max gap ${rows.map((one) => one.maxGap).join('/')} ms`
  note(`FIRST opens: ${sum(firsts)}`)
  note(`SECOND opens: ${sum(seconds)}`)
  await drive.capture('after the clicks', async () => JSON.stringify(results.map((one) => [one.kind, one.name, one.painted])))
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2), 'utf8').catch(() => undefined)
  await writeFile(join(out, 'notes.txt'), notes.join('\n') + '\n', 'utf8').catch(() => undefined)
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Four teammates, nothing sent; one CPU profile per click, first opens against second opens.`, extra: notes.slice(-2).join('\n') })
}
say('MEASURED')
