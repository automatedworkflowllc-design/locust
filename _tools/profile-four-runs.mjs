// Where the window spends its time while four teammates stream at once (bug 3, measured first).
//
//   node _tools/profile-four-runs.mjs [--packaged <exe>] [--tag <name>] [--minutes 5] [--every 4000]
//
// Colin, 10/03: "the app isnt super responsive" with several runs going. The
// PRD (6.2, week 1): a drive that streams four free runs and profiles the
// packaged app over CDP, then only what the profile shows. This seeds four
// teammates on OpenCode's free model, measures the idle window first (three
// clicks between faces: time to the second frame, longest frame gap, long
// tasks), starts all four runs without waiting, and then every few seconds
// clicks to the next teammate and takes the same measures until every run
// has ended or the time is up. A CPU profile of the whole run is kept beside
// the numbers (results.json, four-runs.cpuprofile, notes.txt). Costs nothing:
// the free model only.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const minutes = Number(arg('--minutes') ?? 5)
const every = Number(arg('--every') ?? 4000)
const FREE = 'opencode/ling-3.0-flash-fin-free'
const TEAM = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', word: 'ALMANAC' },
  { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', word: 'BRAMBLE' },
  { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', word: 'CINDER' },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Code & Migrations', word: 'DRIFTWOOD' }
]
const workspace = await scratchRepository('locust-drive-four-runs-ws-')
const out = join(recordRoot('four-runs-2026-10-04'), tag)
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `four-runs-${tag}`,
  port: 9851,
  workspace,
  outPath: out,
  seed: {
    schemaVersion: 1,
    teammates: TEAM.map((one, i) => ({ teammateId: one.teammateId, name: one.name, hue: one.hue, role: one.role, createdAt: `2026-09-05T05:00:0${String(i)}.000Z`, route: { runtime: 'opencode', model: FREE, mode: 'accept-edits' } })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }

/** Click to a teammate and measure the window around it: paint, frame gaps, long tasks. */
const clickAndMeasure = (name) => `(async () => {
  const face = ${teammateFace(name)}
  if (!face) return JSON.stringify({ missing: ${JSON.stringify(name)} })
  const at = performance.now()
  face.click()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const painted = performance.now() - at
  await new Promise((r) => setTimeout(r, 800))
  const gaps = window.__gaps.filter(([when]) => when >= at).map(([, gap]) => gap)
  const tasks = window.__tasks.filter(([when]) => when >= at - 5).map(([, duration]) => Math.round(duration))
  return JSON.stringify({ name: ${JSON.stringify(name)}, painted: Math.round(painted), maxGap: Math.round(Math.max(0, ...gaps)), gapsOver50: gaps.filter((gap) => gap > 50).length, tasks, nodes: document.querySelector('.lc-thread')?.querySelectorAll('*').length ?? 0 })
})()`
/** What happened since the last read, between clicks: the streaming itself. */
const sinceLast = `(() => {
  const from = window.__mark ?? 0
  const now = performance.now()
  const gaps = window.__gaps.filter(([when]) => when >= from).map(([, gap]) => gap)
  const tasks = window.__tasks.filter(([when]) => when >= from).map(([, duration]) => Math.round(duration))
  window.__mark = now
  return JSON.stringify({ span: Math.round(now - from), frames: gaps.length, maxGap: Math.round(Math.max(0, ...gaps)), gapsOver50: gaps.filter((gap) => gap > 50).length, gapsOver100: gaps.filter((gap) => gap > 100).length, longTasks: tasks.length, longTaskMs: tasks.reduce((sum, one) => sum + one, 0), longestTask: Math.max(0, ...tasks) })
})()`
const states = `JSON.stringify((${teammateRows()}).map((row) => ({ name: row.name, activity: row.activity })))`
const startFor = (one) => `(async () => {
  ${teammateFace(one.name)}.click()
  await new Promise((r) => setTimeout(r, 350))
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no composer for ${one.name}'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(`Write a 150-line poem about locusts into a file named ${one.word}.txt, writing it in five pieces of thirty lines each (create the file, then append four times), then reply with exactly the word ${one.word} and nothing else.`)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  field.form.requestSubmit()
  await new Promise((r) => setTimeout(r, 400))
  return 'sent to ${one.name}'
})()`

const idle = []
const ticks = []
let profile
try {
  await drive.ready()
  await drive.resize(1400, 900)
  const rostered = Number(await drive.evaluate(`document.querySelectorAll('.lc-faces__one').length`))
  if (rostered !== 4) throw new Error(`roster holds ${String(rostered)} teammates, not 4 -- a seeded record did not parse`)
  await drive.evaluate(`(() => {
    window.__gaps = []; window.__tasks = []; window.__mark = performance.now()
    let previous
    const frame = (now) => { if (previous !== undefined) window.__gaps.push([now, now - previous]); previous = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__tasks.push([entry.startTime, entry.duration]) }).observe({ type: 'longtask', buffered: false }) } catch {}
    return 'recording'
  })()`)
  await drive.send('Profiler.enable')
  await drive.send('Profiler.setSamplingInterval', { interval: 200 })
  await drive.send('Profiler.start')
  // The idle window first: the same clicks with nothing running, so the streaming numbers have a baseline.
  for (const one of TEAM.slice(0, 3)) {
    idle.push(JSON.parse(String(await drive.evaluate(clickAndMeasure(one.name)))))
    await sleep(300)
  }
  note(`idle, three clicks: ${JSON.stringify(idle)}`)
  await drive.evaluate(sinceLast)
  // Four runs, started without waiting for one another.
  const startedAt = Date.now()
  for (const one of TEAM) note(String(await drive.evaluate(startFor(one))))
  await drive.capture('four runs started', async () => String(await drive.evaluate(states)))
  const deadline = startedAt + minutes * 60_000
  let turn = 0
  let allDoneAt
  while (Date.now() < deadline) {
    await sleep(every)
    const between = JSON.parse(String(await drive.evaluate(sinceLast)))
    const one = TEAM[turn % TEAM.length]
    turn += 1
    const click = JSON.parse(String(await drive.evaluate(clickAndMeasure(one.name))))
    const who = JSON.parse(String(await drive.evaluate(states)))
    const working = who.filter((row) => /work|think|writ|run/i.test(row.activity ?? '')).length
    const tick = { t: Math.round((Date.now() - startedAt) / 1000), working, between, click }
    ticks.push(tick)
    note(`t+${String(tick.t)}s working=${String(working)} between=${JSON.stringify(between)} click=${JSON.stringify(click)}`)
    if (working === 0) {
      allDoneAt = allDoneAt ?? tick.t
      if (ticks.filter((held) => held.working === 0).length >= 2) break
    }
    if (turn === 2) await drive.capture('streaming, four at once', async () => JSON.stringify(who))
  }
  const stopped = await drive.send('Profiler.stop')
  profile = stopped?.result?.profile
  // The summary, from the numbers alone.
  const busy = ticks.filter((tick) => tick.working >= 3)
  const quieter = ticks.filter((tick) => tick.working > 0 && tick.working < 3)
  const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)] }
  const line = (label, rows) => rows.length === 0
    ? `${label}: no ticks`
    : `${label}: ${String(rows.length)} ticks; click paint median ${String(median(rows.map((tick) => tick.click.painted)))} ms, max ${String(Math.max(...rows.map((tick) => tick.click.painted)))} ms; frame gap max ${String(Math.max(...rows.map((tick) => Math.max(tick.between.maxGap, tick.click.maxGap))))} ms; gaps over 100 ms ${String(rows.reduce((sum, tick) => sum + tick.between.gapsOver100, 0))}; long tasks ${String(rows.reduce((sum, tick) => sum + tick.between.longTasks, 0))} (${String(rows.reduce((sum, tick) => sum + tick.between.longTaskMs, 0))} ms, longest ${String(Math.max(0, ...rows.map((tick) => tick.between.longestTask)))} ms)`
  note(line('idle (before any run)', idle.map((one) => ({ click: one, between: { maxGap: one.maxGap, gapsOver100: 0, longTasks: one.tasks.length, longTaskMs: one.tasks.reduce((s, t) => s + t, 0), longestTask: Math.max(0, ...one.tasks) } }))))
  note(line('three or four working', busy))
  note(line('one or two working', quieter))
  note(`all four ended at t+${allDoneAt === undefined ? 'not within the time' : `${String(allDoneAt)}s`}`)
  // The profile's heaviest functions by self time.
  if (profile?.nodes) {
    const self = new Map()
    const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples?.length ?? 1)
    for (const node of profile.nodes) {
      const frame = node.callFrame ?? {}
      const url = String(frame.url ?? '').split(/[\\/]/).pop() ?? ''
      const key = `${frame.functionName || '(anonymous)'} ${url}${frame.lineNumber !== undefined ? `:${String(frame.lineNumber + 1)}` : ''}`
      self.set(key, (self.get(key) ?? 0) + (node.hitCount ?? 0) * interval / 1000)
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, ms]) => `${String(Math.round(ms))} ms  ${key}`)
    note(`profile: ${String(Math.round((profile.endTime - profile.startTime) / 1000))} ms sampled; heaviest by self time:\n    ${top.join('\n    ')}`)
  }
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(out, 'results.json'), JSON.stringify({ idle, ticks }, null, 2), 'utf8').catch(() => undefined)
  if (profile !== undefined) await writeFile(join(out, 'four-runs.cpuprofile'), JSON.stringify(profile), 'utf8').catch(() => undefined)
  await writeFile(join(out, 'notes.txt'), notes.join('\n') + '\n', 'utf8').catch(() => undefined)
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Four teammates on the free OpenCode model started together; the window measured every ${String(every)} ms while they ran.`, extra: notes.slice(-6).join('\n') })
}
say('MEASURED')
