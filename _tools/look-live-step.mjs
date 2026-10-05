// The thread's live row -- "Thinking...", the step a teammate is on -- drawn
// with the app's own stylesheet, at its botSizes.ts size, to LOOK at (0.561).
//
//   node _tools/look-live-step.mjs <out.png>
//
// Writes <out>-thread.png, -two.png, -three.png and -narrow.png: the row at
// the thread's width and at a 2-, 3- and 4-column compare's. A long action
// label is the point: since 0.569 the label carries the model's own words,
// which must stay inside the column (0.631).
//
// The widths are PINNED (min = max = width, flex none). Without that the
// page's flex row gave every column the same width and the captions' numbers
// were not what was drawn.
//
// LOOK_SRC_DESKTOP=<another checkout's apps/desktop> draws that checkout's
// components instead, for a before/after pair from one tool.
//
// Colin, 2026-10-03, with a frame of that row: "we might have to make them a
// little bigger now that i keep having you add these assets". A real turn
// shows the row only while it runs, so this draws it directly. Bundled from
// the app's own components in the app's own Electron; nothing is sent.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const require = createRequire(join(DESKTOP, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const electron = require('electron')
const out = resolve(process.argv[2] ?? join(tmpdir(), 'live-step.png'))
const SRC_DESKTOP = process.env.LOOK_SRC_DESKTOP ?? DESKTOP
const src = (path) => JSON.stringify(join(SRC_DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveStepCard } from ${src('components/ThreadItems.tsx')}

const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0 } }
const atlas = { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', avatar: { headwear: 2, accessory: 1, mouth: 0, bot: { shape: 'droid', face: 'eyes' } } }
const LONG = 'Final regression playthroughs across classes and layouts'
const rows = [
  { owner: wren, activity: 'thinking', label: 'Thinking', detail: undefined, kind: 'reasoning', register: 'thinking', waiting: true },
  { owner: atlas, activity: 'working', label: 'Running the tests', action: LONG, detail: 'npm test', kind: 'item', register: 'tool', orb: 'working' },
  { owner: wren, activity: 'working', label: 'Reading files', action: 'Reading the save system', detail: 'src/save.ts', kind: 'item', register: 'tool', orb: 'working' },
  { owner: atlas, activity: 'working', label: 'Working', action: LONG, detail: undefined, kind: 'item', register: 'tool', orb: 'working' },
  { owner: wren, activity: 'working', label: 'Checking the build output across every package', detail: 'pnpm -r build', kind: 'item', register: 'tool', orb: 'working' }
]
function Column({ width, caption }) {
  return h('div', { className: 'lc-thread', style: { width, minWidth: width, maxWidth: width, flex: 'none', boxSizing: 'border-box', padding: 16, background: 'var(--lc-bg-app, #121316)', border: '1px solid #2a2e36' } },
    h('div', { style: { color: '#8a8f98', font: '11px sans-serif', marginBottom: 8 } }, caption + ' (' + width + 'px)'),
    rows.map((row, i) => h(LiveStepCard, { key: i, startedAt: new Date(Date.now() - 4000).toISOString(), face: true, ...row })))
}
function Page() {
  return h('div', { style: { display: 'flex', gap: 16, padding: 16, background: '#16181c', alignItems: 'flex-start' } },
    h(Column, { width: 520, caption: 'Thread width' }),
    h(Column, { width: 360, caption: 'Two columns' }),
    h(Column, { width: 260, caption: 'Three columns' }),
    h(Column, { width: 200, caption: 'Narrowest' }))
}
createRoot(document.getElementById('root')).render(h(Page))
`

const work = await mkdtemp(join(tmpdir(), 'locust-live-step-'))
await writeFile(join(work, 'entry.jsx'), ENTRY, 'utf8')
await esbuild.build({
  entryPoints: [join(work, 'entry.jsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  outfile: join(work, 'page.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' },
  nodePaths: [join(DESKTOP, 'node_modules')],
  absWorkingDir: DESKTOP,
  logLevel: 'warning'
})
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#16181c;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1480, height: 440, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 1800))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  // Also crop each column for the handoff's "thread" and "compare" pair.
  const bounds = await win.webContents.executeJavaScript(\`(() => {
    const cols = [...document.querySelectorAll('.lc-thread')]
    return cols.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })
  })()\`)
  const full = image
  const base = ${JSON.stringify(out)}.replace(/[.]png$/, '')
  for (const [i, name] of [[0, 'thread'], [1, 'two'], [2, 'three'], [3, 'narrow']]) {
    const b = bounds[i]
    if (!b) continue
    const crop = await win.webContents.capturePage(b)
    writeFileSync(base + '-' + name + '.png', crop.toPNG())
  }
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + ' (+-thread, -two, -three, -narrow)\\n')
  void full
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
