// The title screen playing (0.562): the app's own HomeCover, with the app's
// CSS, filmed for twenty seconds -- the worker typing, finishing and waiting,
// the thinker thinking and having its idea, the locust asleep -- then a
// pointer brought near the locust to wake it, and a click on it.
//
//   node _tools/look-cover.mjs <out-dir>      -> <out-dir>/cover-00.png ... and cover-sheet.png
//
// Colin, 2026-10-03: "for our splash screen its a bit sloppier now ... make it
// so some of them have different terminal eyes ... give real effort into
// making this production quality". Bundled from the app's own components in
// the app's own Electron; nothing is sent.

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
const outDir = resolve(process.argv[2] ?? join(tmpdir(), 'locust-cover-look'))
await mkdir(outDir, { recursive: true })
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { HomeCover } from ${src('components/HomeCover.tsx')}

// A hidden window never has focus, and the cover rests without it: say it has.
document.hasFocus = () => true
createRoot(document.getElementById('root')).render(
  h('div', { style: { width: 960, padding: '40px 0 20px', background: 'var(--lc-bg-window, #121316)' } },
    h(HomeCover, { ready: true, tube: 'full' }))
)
`

const work = await mkdtemp(join(tmpdir(), 'locust-look-cover-'))
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
await writeFile(join(work, 'page.html'), '<!doctype html><html><head><link rel="stylesheet" href="page.css"></head><body style="margin:0;background:#121316"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 960, height: 430, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2500))
  const shoot = async (name) => writeFileSync(join(${JSON.stringify(outDir)}, name), (await win.webContents.capturePage()).toPNG())
  for (let f = 0; f < 14; f += 1) {
    await shoot('cover-' + String(f).padStart(2, '0') + '.png')
    await new Promise((r) => setTimeout(r, 1500))
  }
  // Wake the locust: a pointer near it, then a click on it.
  const at = await win.webContents.executeJavaScript("(() => { const b = document.querySelector('.lc-bot[data-bot=hopper]').getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] })()")
  for (let i = 0; i < 6; i += 1) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at[0] + 60 - i * 10, y: at[1] + 20 })
    await new Promise((r) => setTimeout(r, 120))
  }
  await new Promise((r) => setTimeout(r, 900))
  await shoot('cover-14-woken.png')
  win.webContents.sendInputEvent({ type: 'mouseDown', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: at[0], y: at[1], button: 'left', clickCount: 1 })
  for (const [wait, name] of [[350, 'cover-15-pleased.png'], [900, 'cover-16-after.png']]) {
    await new Promise((r) => setTimeout(r, wait))
    await shoot(name)
    process.stdout.write(name + ': ' + (await win.webContents.executeJavaScript("JSON.stringify([...document.querySelectorAll('.lc-cover .lc-bot')].map((b) => b.dataset.bot + ':' + b.dataset.beat + ':' + b.dataset.state))")) + '\\n')
  }
  process.stdout.write('wrote ' + ${JSON.stringify(outDir)} + '\\n')
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
