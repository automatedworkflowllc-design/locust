// Where a click between two real conversations spends its time (0.572).
//
//   node _tools/profile-real-switch.mjs --packaged <exe> --out <folder outside the repo> [--rows 0,1] [--clicks 12]
//
// Colin, 10/03: "hitching/lagging when clicking between two working sessions".
// The fixture profiler (exec/session-switch) drew one turn per session and
// switched in 2-3 frames; its "684-801 ms max frame gap" was the setup burst,
// recorded before the first click. Real conversations have many turns of
// thousands of events. This copies the person's own ledger (read only:
// mission-ledger, teammates.json, folders.json, groups.json -- never routines,
// rooms or queued messages, so nothing can start) into a throwaway profile,
// launches the built app on it, sends nothing, and clicks between two
// conversations. Per click: time to the second frame, the longest frame gap in
// the 800 ms after, long tasks, and a CPU profile of the whole run. The
// screenshots show the person's conversations: keep --out outside the repo.

import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const out = resolve(arg('--out') ?? join(tmpdir(), 'locust-real-switch'))
const rowsWanted = (arg('--rows') ?? '0,1').split(',').map(Number)
const clicks = Number(arg('--clicks') ?? 12)
if (out.toLowerCase().includes('locust-ship-wt')) throw new Error('--out must be outside the repository: the screenshots show real conversations')
await mkdir(out, { recursive: true })

const source = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
const profile = await mkdtemp(join(tmpdir(), 'locust-real-switch-profile-'))
await cp(join(source, 'mission-ledger'), join(profile, 'mission-ledger'), { recursive: true })
for (const file of ['teammates.json', 'folders.json', 'groups.json']) {
  if (existsSync(join(source, file))) await cp(join(source, file), join(profile, file))
}
// `--plush` (0.577): the COPY's settings turn Plush on, to measure fur against plastic on the same conversations.
if (process.argv.includes('--plush') && existsSync(join(profile, 'teammates.json'))) {
  const roster = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8'))
  roster.settings = { ...(roster.settings ?? {}), plush: true }
  await writeFile(join(profile, 'teammates.json'), JSON.stringify(roster), 'utf8')
}
const workspace = await mkdtemp(join(tmpdir(), 'locust-real-switch-ws-'))
const drive = await startDrive({ name: 'real-switch', port: 9874, workspace, profilePath: profile, outPath: out, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }
try {
  await drive.ready()
  await drive.resize(1400, 900)
  await sleep(6000)
  await drive.evaluate(`(() => {
    window.__gaps = []; window.__tasks = []
    let previous
    const frame = (now) => { if (previous !== undefined) window.__gaps.push([now, now - previous]); previous = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__tasks.push([entry.startTime, entry.duration]) }).observe({ type: 'longtask', buffered: false }) } catch {}
    return 'recording'
  })()`)
  const rows = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('button.lc-conv')].map((row, at) => ({ at, title: (row.getAttribute('title') ?? row.innerText).replace(/\\s+/g, ' ').slice(0, 90) })))`)))
  note(`rows: ${rows.length}; first ten: ${JSON.stringify(rows.slice(0, 10))}`)
  await drive.send('Profiler.enable')
  await drive.send('Profiler.setSamplingInterval', { interval: 200 })
  await drive.send('Profiler.start')
  const results = []
  for (let n = 0; n < clicks; n += 1) {
    const index = rowsWanted[n % rowsWanted.length]
    const one = JSON.parse(String(await drive.evaluate(`(async () => {
      const row = document.querySelectorAll('button.lc-conv')[${String(index)}]
      if (!row) return JSON.stringify({ missing: true })
      const at = performance.now()
      row.click()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const painted = performance.now() - at
      await new Promise((r) => setTimeout(r, 800))
      const gaps = window.__gaps.filter(([when]) => when >= at).map(([, gap]) => gap)
      const tasks = window.__tasks.filter(([when]) => when >= at - 5).map(([, duration]) => Math.round(duration))
      return JSON.stringify({ row: ${String(index)}, painted: Math.round(painted), maxGap: Math.round(Math.max(0, ...gaps)), gapsOver50: gaps.filter((gap) => gap > 50).map(Math.round), tasks, nodes: document.querySelector('.lc-thread')?.querySelectorAll('*').length ?? 0, bots: document.querySelectorAll('.lc-bot').length, threadBots: document.querySelectorAll('.lc-thread .lc-bot').length, canvases: document.querySelectorAll('canvas').length })
    })()`)))
    results.push(one)
    note(`click ${String(n + 1)}: ${JSON.stringify(one)}`)
    if (n === 1) {
      const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
      if (picture?.result?.data) await writeFile(join(out, 'switched.png'), Buffer.from(picture.result.data, 'base64'))
    }
    await sleep(300)
  }
  // The window (0.573): opened at the bottom, and scrolling to the top puts older turns on the page.
  const windowed = String(await drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-thread')
    const label = () => document.querySelector('.lc-thread__earlier')?.textContent ?? 'none'
    const atBottom = box ? Math.round(box.scrollHeight - box.clientHeight - box.scrollTop) : null
    const before = label()
    if (box) box.scrollTop = 0
    await new Promise((r) => setTimeout(r, 1500))
    const after = label()
    const top = box ? Math.round(box.scrollTop) : null
    return JSON.stringify({ distanceFromBottomOnOpen: atBottom, button: before, afterScrollingUp: after, scrollTopAfterLoad: top })
  })()`))
  note(`window: ${windowed}`)
  // What the thread is made of: elements under each kind of block, largest first.
  const census = String(await drive.evaluate(`(() => {
    const thread = document.querySelector('.lc-thread')
    if (!thread) return 'no thread'
    const counts = new Map()
    for (const el of thread.querySelectorAll('*')) {
      const kind = [...el.classList].find((name) => name.startsWith('lc-')) ?? el.tagName.toLowerCase()
      counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    const hidden = [...thread.querySelectorAll('*')].filter((el) => el.offsetParent === null && getComputedStyle(el).position !== 'fixed').length
    const svg = thread.querySelectorAll('svg *').length
    return JSON.stringify({ total: thread.querySelectorAll('*').length, notDisplayed: hidden, insideSvg: svg, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25) })
  })()`))
  note(`census of the last thread: ${census}`)
  const stopped = await drive.send('Profiler.stop')
  await writeFile(join(out, 'switch.cpuprofile'), JSON.stringify(stopped?.result?.profile ?? {}))
  await writeFile(join(out, 'results.json'), JSON.stringify({ rows: rows.slice(0, 20), results }, null, 2))
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(out, 'notes.txt'), notes.join('\n') + '\n', 'utf8')
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Clicking between real conversations (a copy of the ledger), nothing sent.`, extra: notes.join('\n') })
}
