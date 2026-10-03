// Many pets at once, as teammates' faces (0.564), to LOOK at a whole cast:
// one row per pet -- resting at the sidebar's sizes and Home's, then the
// states a teammate shows at 44 -- drawn with the app's own components and
// stylesheet, seven pets to a picture.
//
//   node _tools/look-pet-cast.mjs <out.png> --sheet <spritesheet.webp> [--sheet ...]
//
// Writes <out>-1.png, <out>-2.png, ... Nothing is sent anywhere.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const require = createRequire(join(DESKTOP, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const electron = require('electron')
const args = process.argv.slice(2)
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--sheet') ?? join(tmpdir(), 'cast.png'))
const paths = args.flatMap((arg, i) => (args[i - 1] === '--sheet' ? [resolve(arg)] : []))
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))
const PER_PAGE = 7

const loaded = []
for (const path of paths) {
  const bytes = await readFile(path)
  const bits = bytes.readUInt32LE(21)
  const height = ((bits >>> 14) & 0x3fff) + 1
  // A sheet's folder names the pet (pets/<id>/spritesheet.webp).
  const id = basename(dirname(path)).replace(/[^a-z0-9_-]/g, '-').slice(0, 60)
  loaded.push({ id, rows: height === 2288 ? 11 : 9, base64: bytes.toString('base64') })
}
const pages = Math.max(1, Math.ceil(loaded.length / PER_PAGE))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TeammateBot } from ${src('components/TeammateBot.tsx')}

const SHEETS = ${JSON.stringify(loaded)}
const bytesOf = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
window.desktop = {
  readPetSheet: async (source, id) => {
    const sheet = SHEETS.find((entry) => entry.id === id)
    return sheet === undefined ? { ok: false, error: { code: 'PETS_UNAVAILABLE', message: 'not here' } } : { ok: true, data: { bytes: bytesOf(sheet.base64), rows: sheet.rows } }
  }
}
const RESTING = [20, 34, 44, 96]
const STATES = [['thinking', 'thinking'], ['working', 'working'], ['waiting', 'waiting'], ['done', 'done'], ['blocked', 'stuck']]
const cell = (children, width) => h('div', { style: { width, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' } }, children)
const face = (pet, size, activity) => h(TeammateBot, { hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0, pet: { source: 'bundled', id: pet } }, size, activity, presence: activity === 'idle' ? 'online' : 'working', runtime: 'claude', motion: 'full' })
function Row({ pet }) {
  return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 10, padding: '8px 10px', background: 'var(--lc-bg-sidebar)' } },
    h('div', { style: { color: '#8a8f98', font: '11px sans-serif', width: 130, alignSelf: 'center', overflow: 'hidden' } }, pet),
    RESTING.map((size) => cell(face(pet, size, 'idle'), size + 14)),
    STATES.map(([activity]) => cell(face(pet, 44, activity), 62)))
}
function Page({ page }) {
  return h('div', { style: { padding: 10, background: 'var(--lc-bg-window, #121316)', display: 'flex', flexDirection: 'column', gap: 4 } },
    h('div', { style: { display: 'flex', gap: 10, padding: '0 10px', color: '#6b7078', font: '10px sans-serif' } },
      h('div', { style: { width: 130 } }, ''), RESTING.map((size) => h('div', { key: size, style: { width: size + 14, textAlign: 'center' } }, size + ' px')),
      STATES.map(([activity, name]) => h('div', { key: activity, style: { width: 62, textAlign: 'center' } }, name + ' 44'))),
    SHEETS.slice(page * ${PER_PAGE}, page * ${PER_PAGE} + ${PER_PAGE}).map((sheet) => h(Row, { key: sheet.id, pet: sheet.id })))
}
const root = createRoot(document.getElementById('root'))
window.showPage = (page) => root.render(h(Page, { page }))
window.showPage(0)
`

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-cast-'))
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
setTimeout(() => { process.stderr.write('look-pet-cast: timed out\\n'); app.exit(2) }, 120000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  for (let page = 0; page < ${pages}; page += 1) {
    await win.webContents.executeJavaScript('window.showPage(' + page + ')')
    await new Promise((r) => setTimeout(r, 7000))
    const image = await win.webContents.capturePage()
    writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/, '-' + (page + 1) + '.png'), image.toPNG())
  }
  process.stdout.write('wrote ${pages} pictures beside ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-pet-cast: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
