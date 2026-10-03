// Pets as teammates' faces (0.563), drawn with the app's own components and
// stylesheet, to LOOK at before shipping.
//
//   node _tools/look-pets.mjs <out.png> [--sheet <spritesheet.webp> ...]
//
// Each pet, in each state a teammate shows (idle, thinking, working,
// receiving, waiting, done, stuck) at the botSizes.ts sizes that matter (20,
// 34, 44) and big (96), beside a bot at the same size -- with the waiting
// ring and a presence dot, so where they sit on the pet can be seen. Three
// frames a moment apart (-a, -b, -c) show the motion. The bundled Hoodie Cat
// always; any other sheet given with --sheet (a pet downloaded for a look,
// kept outside the repository). Nothing is sent anywhere.

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
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--sheet') ?? join(tmpdir(), 'pets.png'))
const extra = args.flatMap((arg, i) => (args[i - 1] === '--sheet' ? [resolve(arg)] : []))
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

// The sheets, as the host would hand them over: bytes and rows (read from the size in the header).
const sheets = [{ id: 'hoodie-cat', path: join(DESKTOP, 'resources/pets/hoodie-cat/spritesheet.webp') }, ...extra.map((path) => ({ id: basename(path).replace(/[.]webp$/, '').replace(/[^a-z0-9_-]/g, '-').slice(0, 60), path }))]
const loaded = []
for (const sheet of sheets) {
  const bytes = await readFile(sheet.path)
  const bits = bytes.readUInt32LE(21)
  const height = ((bits >>> 14) & 0x3fff) + 1
  loaded.push({ id: sheet.id, rows: height === 2288 ? 11 : 9, base64: bytes.toString('base64') })
}

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
const STATES = [['idle', 'idle'], ['thinking', 'thinking'], ['working', 'working'], ['receiving', 'receiving'], ['waiting', 'waiting'], ['done', 'done'], ['blocked', 'stuck']]
const SIZES = [20, 34, 44, 96]
const label = (text) => h('div', { style: { color: '#8a8f98', font: '11px sans-serif', width: 70 } }, text)
function Row({ pet, size }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '6px 0' } },
    label(pet + ' ' + size),
    STATES.map(([activity, name]) => h('div', { key: activity, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: Math.max(size, 40) + 30 } },
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'flex-end' } },
        h(TeammateBot, { hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0, pet: { source: 'bundled', id: pet } }, size, activity, presence: activity === 'idle' ? 'online' : 'working', motion: 'full' }),
        size < 96 ? h(TeammateBot, { hue: 'blue', avatar: { headwear: 2, accessory: 1, mouth: 0, bot: { shape: 'droid', face: 'eyes' } }, size, activity, presence: activity === 'idle' ? 'online' : 'working' }) : null),
      h('div', { style: { color: '#6b7078', font: '10px sans-serif' } }, name))))
}
function Page() {
  return h('div', { style: { padding: 16, background: 'var(--lc-bg-window, #121316)' } },
    SHEETS.map((sheet) => SIZES.map((size) => h(Row, { key: sheet.id + size, pet: sheet.id, size }))))
}
createRoot(document.getElementById('root')).render(h(Page))
`

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-pets-'))
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
const height = 40 + loaded.length * (20 + 34 + 44 + 96 + 4 * 34)
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
// Never left running: a failure, or a page that never draws, ends it.
setTimeout(() => { process.stderr.write('look-pets: timed out\\n'); app.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1180, height: ${height}, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 1500))
  for (const name of ['a', 'b', 'c']) {
    const image = await win.webContents.capturePage()
    writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/, '-' + name + '.png'), image.toPNG())
    await new Promise((r) => setTimeout(r, 330))
  }
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + ' (-a, -b, -c)\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-pets: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
