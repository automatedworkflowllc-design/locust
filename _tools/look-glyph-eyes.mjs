// A sheet of teammate bots with code-glyph eyes (0.559), to LOOK at.
//
//   node _tools/look-glyph-eyes.mjs <out.png>
//
// Colin, 2026-10-02: "I kind of like what the codex mascot does with the eyes
// making them different coding lines. Should we implement that to all of our
// teammates?" Rows: shapes (the library's, Locust's own, and the two that nod
// to the agents). Columns: the rig's own eyes, then each glyph pair, at the
// cover's 96 and the header's 32; a last pair turned to each side. Bundled
// from the app's own Bot.tsx in the app's own Electron; nothing is sent.

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
const out = resolve(process.argv[2] ?? join(tmpdir(), 'glyph-eyes.png'))

const ENTRY = `
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Bot } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/components/Bot.tsx').replace(/\\/g, '/'))}

const shapes = [['droid', '#5b8def'], ['ghost', '#c7a6ff'], ['cat', '#ff8c42'], ['hopper', '#7fd17a'], ['critter', '#e8845c'], ['prompt', '#6fb7d6']]
const eyes = [[undefined, 'own'], [['>', '▮'], 'working'], [['•', '•'], 'thinking'], [['^', '^'], 'done'], [['x', 'x'], 'blocked']]
const cell = (children, label) => h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 112 } }, children, h('span', { style: { color: '#8a8f98', font: '11px sans-serif' } }, label))
createRoot(document.getElementById('root')).render(h('div', { style: { padding: 16, display: 'grid', gap: 10 } },
  shapes.map(([type, color], row) => h('div', { key: type, style: { display: 'flex', gap: 6, alignItems: 'flex-end' } },
    h('span', { style: { color: '#c9ccd1', font: '12px sans-serif', width: 60 } }, type),
    eyes.map(([glyphs, label]) => cell(h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 8 } },
      h('span', { style: { display: 'inline-flex', width: 96, height: 96, position: 'relative' } }, h(Bot, { type, size: 96, color, paused: true, seed: 0.2 + row * 0.1, ...(glyphs ? { eyes: glyphs } : {}) })),
      ), label)),
    eyes.slice(1, 3).map(([glyphs, label]) => cell(h('span', { style: { display: 'inline-flex', width: 32, height: 32, position: 'relative' } }, h(Bot, { type, size: 32, color, paused: true, seed: 0.2 + row * 0.1, eyes: glyphs })), label + ' 32')),
    cell(h('span', { style: { display: 'inline-flex', width: 96, height: 96, position: 'relative' } }, h(Bot, { type, size: 96, color, paused: false, seed: 0.2 + row * 0.1, glance: { x: 1, y: 0 }, eyes: ['>', '▮'] })), 'glancing')
  ))
))
`

const work = await mkdtemp(join(tmpdir(), 'locust-glyph-eyes-'))
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
  nodePaths: [join(DESKTOP, 'node_modules')],
  absWorkingDir: DESKTOP,
  logLevel: 'warning'
})
await writeFile(join(work, 'page.html'), '<!doctype html><html><body style="background:#16181c;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2500))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
