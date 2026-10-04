// The runtime's badge on a face (TeammateBot `runtime`), drawn with the app's
// own components and stylesheet, to LOOK at before shipping (0.564: Sol's
// 0.562 beta found it crowding a 32 px face).
//
//   node _tools/look-badge.mjs <out.png>
//
// Four bot shapes, each runtime's mark, at the sidebar's sizes and Home's,
// with the presence dot opposite. Nothing is sent anywhere.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
const out = resolve(process.argv[2] ?? join(tmpdir(), 'badge.png'))
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TeammateBot } from ${src('components/TeammateBot.tsx')}

const SHAPES = ['pill', 'pebble', 'droid', 'cat']
const RUNTIMES = ['claude', 'codex', 'cursor', 'opencode']
const HUES = ['lime', 'blue', 'violet', 'amber']
const SIZES = [32, 34, 44, 56]
const label = (text) => h('div', { style: { color: '#8a8f98', font: '11px sans-serif', width: 54 } }, text)
function Row({ size }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 18, padding: '8px 12px', background: 'var(--lc-bg-sidebar)' } },
    label(size + ' px'),
    SHAPES.flatMap((shape, i) => RUNTIMES.map((runtime, j) => h('div', { key: shape + runtime, style: { width: size + 10, display: 'flex', justifyContent: 'center' } },
      h(TeammateBot, { hue: HUES[(i + j) % 4], avatar: { headwear: 1, accessory: 0, mouth: 0, bot: { shape, face: 'eyes' } }, size, activity: 'idle', presence: j % 2 === 0 ? 'online' : 'working', runtime, motion: 'none' })))))
}
function Page() {
  return h('div', { style: { padding: 12, background: 'var(--lc-bg-window, #121316)', display: 'flex', flexDirection: 'column', gap: 6 } },
    SIZES.map((size) => h(Row, { key: size, size })))
}
createRoot(document.getElementById('root')).render(h(Page))
`

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-badge-'))
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
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#121316;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
// Never left running: a failure, or a page that never draws, ends it.
setTimeout(() => { process.stderr.write('look-badge: timed out\\n'); app.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1300, height: 360, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 1500))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-badge: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
