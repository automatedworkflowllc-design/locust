// Screen faces IN MOTION, as a film strip, to look at before and after changing them (0.568).
// Colin, 2026-10-03: "the screen faces are a little janky ... they kind of clip
// around and go crazy ... might just need some proper motion/screen physics".
//
//   node _tools/look-screen-motion.mjs <out.png> [--every 70] [--frames 14] [--size 56]
//                                      [--lib <bot-avatars package folder>] [--shading plastic|fabric]
//
// Rows: each state a teammate can be in. In each frame, the same states on a
// few screen-wearing shapes, drawn with the app's own TeammateBot and
// stylesheet. Frames run left to right, `--every` ms apart, so a jump, a clip
// or a jitter shows as a cell that does not follow from the one before it.
// --lib / --shading as look-bot-shading.mjs. Nothing is sent anywhere.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
const args = process.argv.slice(2)
const VALUED = ['--lib', '--shading', '--every', '--frames', '--size', '--states', '--per-row']
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && !VALUED.includes(args[i - 1])) ?? join(tmpdir(), 'screen-motion.png'))
const lib = option('--lib')
const shading = option('--shading') ?? 'plastic'
const every = Number(option('--every') ?? '70')
const frames = Number(option('--frames') ?? '14')
const size = Number(option('--size') ?? '56')
if (!['plastic', 'fabric'].includes(shading)) throw new Error('--shading takes plastic or fabric')
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const STATES = (option('--states') ?? 'idle,thinking,working,waiting,done,blocked').split(',')
const PER_ROW = Number(option('--per-row') ?? '8')
const SHAPES = ['droid', 'mech', 'ghost', 'cat']
const HUES = ['blue', 'clay', 'violet', 'teal']
const CELL_W = SHAPES.length * (size + 10) + 8
const CELL_H = size + 22

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TeammateBot } from ${src('components/TeammateBot.tsx')}

const STATES = ${JSON.stringify(STATES)}
const SHAPES = ${JSON.stringify(SHAPES)}
const HUES = ${JSON.stringify(HUES)}
function Page() {
  return h('div', { style: { background: 'var(--lc-bg-sidebar)', width: ${CELL_W}, padding: 0 } },
    STATES.map((activity) => h('div', { key: activity, style: { height: ${CELL_H}, display: 'flex', alignItems: 'center', gap: 10, padding: '0 4px', position: 'relative' } },
      SHAPES.map((shape, i) => h('div', { key: shape, style: { width: ${size}, display: 'flex', justifyContent: 'center' } },
        h(TeammateBot, { hue: HUES[i], avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape, face: 'eyes', screen: true } }, size: ${size}, activity, presence: 'online', motion: 'full' }))))))
}
createRoot(document.getElementById('root')).render(h(Page))
`

const swap = {
  name: 'look-screen-motion',
  setup(build) {
    build.onLoad({ filter: /components[\\/]Bot\.tsx$/ }, async (found) => {
      const text = await readFile(found.path, 'utf8')
      if (!text.includes("shading: 'plastic',")) throw new Error("Bot.tsx no longer says shading: 'plastic' -- update this tool")
      return { contents: text.replace("shading: 'plastic',", `shading: '${shading}',`), loader: 'tsx' }
    })
  }
}

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-motion-'))
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
  plugins: [swap],
  ...(lib === undefined ? {} : { alias: { 'bot-avatars': join(resolve(lib), 'dist', 'index.es.js') } }),
  logLevel: 'warning'
})
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#121316;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
const H = STATES.length * CELL_H
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
setTimeout(() => { process.stderr.write('look-screen-motion: timed out\\n'); app.exit(2) }, 120000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: ${CELL_W}, height: ${H}, useContentSize: true, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 4000))
  const shots = []
  for (let i = 0; i < ${frames}; i += 1) {
    const began = Date.now()
    shots.push((await win.webContents.capturePage()).toDataURL())
    await new Promise((r) => setTimeout(r, Math.max(0, ${every} - (Date.now() - began))))
  }
  // The strip: frames left to right, wrapped every PER_ROW, the states down the side of each band.
  const per = Math.min(${PER_ROW}, shots.length)
  const bands = Math.ceil(shots.length / per)
  const bandH = ${H} + 24
  const sheet = new BrowserWindow({ show: false, width: 70 + per * (${CELL_W} + 4), height: bands * bandH, useContentSize: true })
  const x = (i) => 70 + (i % per) * (${CELL_W} + 4)
  const y = (i) => Math.floor(i / per) * bandH
  const labels = Array.from({ length: bands }, (_, b) => ${JSON.stringify(STATES)}.map((s, i) => '<div style="position:absolute;left:4px;top:' + (b * bandH + 24 + i * ${CELL_H} + ${CELL_H} / 2 - 7) + 'px;color:#8a8f98;font:11px sans-serif">' + s + '</div>').join('')).join('')
  const heads = shots.map((_, i) => '<div style="position:absolute;left:' + x(i) + 'px;top:' + (y(i) + 4) + 'px;color:#8a8f98;font:11px sans-serif">' + (i * ${every}) + ' ms</div>').join('')
  const imgs = shots.map((url, i) => '<img src="' + url + '" style="position:absolute;left:' + x(i) + 'px;top:' + (y(i) + 24) + 'px;width:${CELL_W}px;height:${H}px">').join('')
  await sheet.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#0b0c0e">' + labels + heads + imgs + '</body>'))
  await new Promise((r) => setTimeout(r, 800))
  writeFileSync(${JSON.stringify(out)}, (await sheet.webContents.capturePage()).toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-screen-motion: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
