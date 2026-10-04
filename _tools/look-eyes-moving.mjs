// The eyes MOVING (0.561): frames of live bots at work, in thought and done,
// a seventh of a second apart, to look at as a strip.
//
//   node _tools/look-eyes-moving.mjs <out.png>     -> out-00.png ... out-29.png  (TERMINAL=off for own eyes)
//
// Colin, 2026-10-03: "thinking and working should have animations where the
// teammate looks alert, not flat lines". Bundled from the app's own Bot.tsx in
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
const FRAMES = 30
const out = resolve(process.argv[2] ?? join(tmpdir(), 'glyph-eyes.png'))

const ENTRY = `
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { Bot } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/components/Bot.tsx').split(String.fromCharCode(92)).join('/'))}
import { setTerminalFaces } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/botLook.ts').split(String.fromCharCode(92)).join('/'))}

setTerminalFaces(${JSON.stringify(process.env.TERMINAL !== 'off')})
const row = [['droid', '#5b8def', ['>', '▮']], ['ghost', '#c7a6ff', ['•', '•']], ['cat', '#ff8c42', ['>', '▮']], ['prompt', '#6fb7d6', ['•', '•']], ['hopper', '#7fd17a', ['^', '^']]]
createRoot(document.getElementById('root')).render(h('div', { style: { display: 'flex', gap: 24, padding: 20 } },
  row.map(([type, color, eyes], i) => h('span', { key: i, style: { display: 'inline-flex', width: 110, height: 110, position: 'relative' } },
    h(Bot, { type, size: 110, color, seed: 0.15 + i * 0.11, jumpEvery: 0, eyes })))))
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
  const FRAMES = ${FRAMES}
  const win = new BrowserWindow({ show: false, width: 760, height: 190, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 1200))
  for (let f = 0; f < FRAMES; f += 1) {
    const image = await win.webContents.capturePage()
    writeFileSync(${JSON.stringify(out)}.replace(/\.png$/, '-' + String(f).padStart(2, '0') + '.png'), image.toPNG())
    await new Promise((r) => setTimeout(r, 140))
  }
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
