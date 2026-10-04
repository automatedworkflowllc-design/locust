// The thread's live row -- "Thinking...", the step a teammate is on -- drawn
// with the app's own stylesheet, at its botSizes.ts size, to LOOK at (0.561).
//
//   node _tools/look-live-step.mjs <out.png>
//
// Colin, 2026-10-03, with a frame of that row: "we might have to make them a
// little bigger now that i keep having you add these assets". A real turn
// shows the row only while it runs, so this draws it directly: thinking and
// working, a teammate with its own shape and one with a picked one, Terminal
// faces on (left) and off (right). Bundled from the app's own components in
// the app's own Electron; nothing is sent.

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
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveStepCard } from ${src('components/ThreadItems.tsx')}
import { setTerminalFaces } from ${src('botLook.ts')}

const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0 } }
const atlas = { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', avatar: { headwear: 2, accessory: 1, mouth: 0, bot: { shape: 'droid', face: 'eyes' } } }
const rows = [
  { owner: wren, activity: 'thinking', label: 'Thinking', detail: undefined, kind: 'reasoning', register: 'thinking', waiting: true },
  { owner: atlas, activity: 'working', label: 'Running the tests', detail: 'npm test', kind: 'item', register: 'tool', orb: 'working' }
]
function Column({ on }) {
  return h('div', { className: 'lc-thread', style: { width: 520, padding: 16, background: 'var(--lc-bg-app, #121316)' } },
    h('div', { style: { color: '#8a8f98', font: '11px sans-serif', marginBottom: 8 } }, on ? 'Terminal faces on' : 'Terminal faces off'),
    rows.map((row, i) => h(LiveStepCard, { key: i, startedAt: new Date(Date.now() - 4000).toISOString(), face: true, ...row })))
}
// Two columns can only differ while the setting is read at mount: draw "on", photograph, then "off".
function Page() {
  const [on, setOn] = useState(true)
  useEffect(() => { setTerminalFaces(on) }, [on])
  window.__setOn = setOn
  return h('div', { style: { display: 'flex', gap: 12, padding: 12, background: '#16181c' } }, h(Column, { on }))
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
  const win = new BrowserWindow({ show: false, width: 560, height: 220, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  for (const [on, name] of [[true, 'on'], [false, 'off']]) {
    await win.webContents.executeJavaScript('window.__setOn(' + on + ')')
    await new Promise((r) => setTimeout(r, 1800))
    const image = await win.webContents.capturePage()
    writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/, '-' + name + '.png'), image.toPNG())
  }
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + ' (-on, -off)\\n')
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
