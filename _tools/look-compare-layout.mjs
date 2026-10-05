// The compare view alone, running and done, blind and revealed, at the sizes
// the app gives it (2026-10-05). No app, no discovery, no model.
//
//   node _tools/look-compare-layout.mjs <out-folder>
//
// What the app cannot be seeded into, it draws here: columns still running
// (a live run is the only way the app has one), and a comparison that edits,
// whose foot carries "+1273 -0 in 1 file" (the app counts it in each column's
// copy). The view is CompareView itself, with the app's own stylesheet, its
// cells built by buildThread from the events in compare-layout-seed.mjs. The
// pane sizes are the app's own at 1200x780, 1000x680 (compact sidebar) and
// 1600x900, measured by _tools/drive-compare-layout-frames.mjs. Each frame's
// measures go to <out-folder>/measures.json.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop')
const require = createRequire(join(desktop, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const out = resolve(process.argv[2] ?? 'compare-layout-look')
await mkdir(out, { recursive: true })
const src = (path) => JSON.stringify(join(desktop, 'src/renderer/src', path).replaceAll('\\', '/'))
const seed = JSON.stringify(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'compare-layout-seed.mjs')).href.replace('file:///', '').replaceAll('\\', '/'))
const work = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-look-compare-layout-'))

// [window, pane width, pane height]: the app's .lc-compare at that window size.
const SIZES = [['1200x780', 932, 606], ['1000x680', 936, 506], ['1600x900', 1332, 726]]

await writeFile(join(work, 'entry.jsx'), `
import ${src('tokens.css')}
import ${src('shell.css')}
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CompareView } from ${src('components/CompareView.tsx')}
import { buildThread } from ${src('missionView.ts')}
import { COLUMNS, PROMPT, columnEvents } from ${seed}

const startedAt = new Date(Date.now() - 90 * 60_000).toISOString()
const CHANGES = { a: '+212 -4 in 2 files', b: '+1273 -0 in 1 file', c: '+96 -31 in 5 files' }
const COSTS = { a: '$0.41', b: '$2.18', c: '312k tokens' }
const SPANS = { a: '1h 09m', b: '1h 18m', c: '1h 27m' }

function columnsFor({ count, running, blind }) {
  const picked = count === 2 ? [COLUMNS[0], COLUMNS[1]] : COLUMNS
  return picked.map((column, index) => {
    // Running: the first column has finished; the others are still at it.
    const live = running && index > 0
    const events = columnEvents(column, { missionId: 'mission_' + column.slot, runId: 'run_' + column.slot, startedAt, running: live })
    const items = buildThread(events, { running: live, mayEdit: false, workspacePath: 'C:/work/rpg' })
    return {
      slot: column.slot,
      name: blind ? 'Model ' + column.slot.toUpperCase() : column.label,
      runtime: 'opencode',
      runtimeName: 'OpenCode',
      turns: [{ missionId: 'mission_' + column.slot, items, running: live }],
      running: live,
      keepable: !live,
      retryable: false,
      answer: live ? '' : 'An answer.',
      state: live ? 'working' : 'done',
      ...(live ? {} : { span: SPANS[column.slot] }),
      ...(live ? {} : { cost: COSTS[column.slot] })
    }
  })
}

window.draw = (scenario) => {
  const columns = columnsFor(scenario)
  const changeLines = scenario.edits ? Object.fromEntries(columns.filter((column) => !column.running).map((column) => [column.slot, CHANGES[column.slot]])) : {}
  const compare = {
    compareId: 'cmp_look', prompt: PROMPT, createdAt: startedAt,
    slots: columns.map((column) => ({ slot: column.slot, route: { runtime: 'opencode', model: column.slot, label: column.name, mode: 'auto' }, missionIds: ['mission_' + column.slot] })),
    ...(scenario.edits ? { changes: true } : {}),
    ...(scenario.blind ? { blind: true } : {})
  }
  flushSync(() => window.root.render(
    <div className="lc-look-pane" style={{ width: scenario.width + 'px', height: scenario.height + 'px', display: 'flex', flexDirection: 'column', background: 'var(--lc-bg-window)' }}>
      <CompareView compare={compare} changeLines={changeLines} prompts={[PROMPT]} columns={columns} owner={undefined} workspacePath="C:/work/rpg" keeping={false} retrying={undefined} onKeep={() => {}} onRetry={() => {}} onBack={undefined} judgeChoices={[{ key: 'j', label: 'OpenCode / Fledge Alpha Free' }]} onJudge={() => {}} />
    </div>
  ))
}
window.root = createRoot(document.getElementById('root'))
`, 'utf8')
await esbuild.build({ entryPoints: [join(work, 'entry.jsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', outfile: join(work, 'page.js'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' }, nodePaths: [join(desktop, 'node_modules')], absWorkingDir: desktop, logLevel: 'error' })
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="margin:0;background:#0f1012"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')

const SCENARIOS = []
for (const count of [2, 3]) {
  for (const running of [true, false]) {
    for (const blind of [true, false]) SCENARIOS.push({ count, running, blind, edits: true })
  }
}

await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const SIZES = ${JSON.stringify(SIZES)}
const SCENARIOS = ${JSON.stringify(SCENARIOS)}
const OUT = ${JSON.stringify(out)}
const MEASURE = ${JSON.stringify(MEASURE_SOURCE())}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 760, useContentSize: true, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise(r => setTimeout(r, 800))
  // LOOK_DUMP=<selector>: the first scenario's matching markup, each element's ::after, to read instead of look at.
  if (process.env.LOOK_DUMP) {
    win.setContentSize(SIZES[0][1], SIZES[0][2])
    await win.webContents.executeJavaScript('window.draw(' + JSON.stringify({ ...SCENARIOS[3], width: SIZES[0][1], height: SIZES[0][2] }) + ')')
    await new Promise(r => setTimeout(r, 350))
    console.log(await win.webContents.executeJavaScript('JSON.stringify([...document.querySelectorAll(' + JSON.stringify(process.env.LOOK_DUMP) + ')].map((el) => ({ html: el.outerHTML.slice(0, 600), after: [...el.querySelectorAll(\\'*\\')].map((c) => getComputedStyle(c, \\'::after\\').content) })), null, 1)'))
    app.exit(0)
    return
  }
  const measures = {}
  for (const [size, width, height] of SIZES) {
    win.setContentSize(width, height)
    for (const scenario of SCENARIOS) {
      const name = size + '-' + scenario.count + 'col-' + (scenario.running ? 'running' : 'done') + '-' + (scenario.blind ? 'blind' : 'revealed')
      await win.webContents.executeJavaScript('window.draw(' + JSON.stringify({ ...scenario, width, height }) + ')')
      await new Promise(r => setTimeout(r, 350))
      for (const at of ['top', 'bottom']) {
        await win.webContents.executeJavaScript("(() => { const s = document.querySelector('.lc-compare__scroll'); s.scrollTo(0, " + (at === 'top' ? '0' : 's.scrollHeight') + ") })()")
        await new Promise(r => setTimeout(r, 250))
        measures[name + '-' + at] = JSON.parse(await win.webContents.executeJavaScript(MEASURE))
        writeFileSync(join(OUT, name + '-' + at + '.png'), (await win.webContents.capturePage({ x: 0, y: 0, width, height })).toPNG())
      }
    }
  }
  writeFileSync(join(OUT, 'measures.json'), JSON.stringify(measures, null, 1))
  console.log('frames: ' + String(Object.keys(measures).length))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
`, 'utf8')
const code = await new Promise((done) => {
  const child = spawn(require('electron'), [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('error', error => { console.error(error); done(1) })
  child.on('close', done)
})
process.exit(code ?? 1)

/** The same measures as drive-compare-layout-frames.mjs, plus whether the live line and each column's last words are in view. */
function MEASURE_SOURCE() {
  return `(() => {
    const r = (el) => el.getBoundingClientRect()
    const scroll = document.querySelector('.lc-compare__scroll')
    const port = r(scroll)
    const cells = [...document.querySelectorAll('.lc-compare__cell')]
    const spills = cells.flatMap((cell, index) => {
      const edge = r(cell).right + 1
      return [...cell.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent.trim().length > 0 && r(el).width > 0 && r(el).right > edge && el.checkVisibility())
        .map((el) => ({ column: index, text: el.textContent.trim().slice(0, 50), over: Math.round(r(el).right - edge) }))
    })
    const lastWords = cells.map((cell) => {
      const leaves = [...cell.querySelectorAll('p, li, .lc-livestep, .lc-agentline__meta, [class*="meta"]')].filter((el) => r(el).height > 0)
      const last = leaves.at(-1)
      if (last === undefined) return null
      const box = r(last)
      return { inView: box.bottom > port.top + 40 && box.top < port.bottom, text: last.textContent.trim().slice(0, 40) }
    })
    const numbers = [...document.querySelectorAll('.lc-compare__numbers')].map((el) => ({ text: el.textContent, cut: el.scrollWidth > el.clientWidth + 1, lines: Math.round(r(el).height) }))
    const prose = cells.map((cell) => { const p = cell.querySelector('p'); return p ? Math.round(r(p).width) : null })
    const font = cells.map((cell) => { const p = cell.querySelector('p'); return p ? getComputedStyle(p).fontSize : null })
    return JSON.stringify({ proseWidth: prose, font, lastWords, numbers, spills: spills.slice(0, 12) })
  })()`
}
