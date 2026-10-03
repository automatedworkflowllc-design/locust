// Every bot shape with Terminal faces on (0.561), to LOOK at: each shape's own
// fitted screen, eyes at work / in thought / done / resting, and six with a mouth.
//
//   node _tools/look-terminal-faces.mjs <out.png>        (TERMINAL=off for the plain eyes)
//
// Colin, 2026-10-03: "maybe im realizing they might all need a screen for a
// face, we can have it togglable in settings, terminal face". Bundled from the
// app's own Bot.tsx in the app's own Electron; nothing is sent.

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
import { Bot } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/components/Bot.tsx').split(String.fromCharCode(92)).join('/'))}
import { BOT_SHAPES } from ${JSON.stringify(join(DESKTOP, 'src/shared/avatar.ts').split(String.fromCharCode(92)).join('/'))}
import { setTerminalFaces } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/botLook.ts').split(String.fromCharCode(92)).join('/'))}

setTerminalFaces(${JSON.stringify(process.env.TERMINAL !== 'off')})
const hues = ['#5b8def', '#c7a6ff', '#ff8c42', '#7fd17a', '#e8845c', '#6fb7d6', '#f06292', '#ffd54f', '#e8ecf2', '#7d8796']
const eyes = [[['>', '▮'], 'cyan'], [['•', '•'], 'cyan'], [['^', '^'], 'green'], [['x', 'x'], 'red'], [undefined, 'amber'], [undefined, 'cyan']]
const cell = (type, i, face, [glyphs, phosphor] = [undefined, 'cyan']) => h('div', { key: type + face + i, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 104 } },
  h('span', { style: { display: 'inline-flex', width: 80, height: 80, position: 'relative' } }, h(Bot, { type, size: 80, color: hues[i % hues.length], paused: true, seed: 0.2 + i * 0.07, face, phosphor, ...(glyphs ? { eyes: glyphs } : {}) })),
  h('span', { style: { color: '#8a8f98', font: '11px sans-serif', marginTop: 4 } }, type + (face === 'mouth' ? ' (mouth)' : '') + ' · ' + phosphor))
createRoot(document.getElementById('root')).render(h('div', { style: { padding: 16, display: 'flex', flexWrap: 'wrap', gap: 6, width: 1240 } },
  [...BOT_SHAPES.map((type, i) => cell(type, i, undefined, eyes[i % eyes.length])), ...BOT_SHAPES.slice(0, 6).map((type, i) => cell(type, i + 3, 'mouth', eyes[i % eyes.length]))]
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
  const win = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { backgroundThrottling: false } })
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
