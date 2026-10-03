// The teammate dock as proposed (docs/DESIGN-teammate-dock.md), drawn with the
// app's own faces and stylesheet, to put in front of Colin before any code.
//
//   node _tools/look-dock.mjs <out.png>
//
// A sketch, not the dock: it is a page laid out the way the design note says
// -- one small window, a row per teammate at work, the one waiting on you in
// amber at the top, a done one hopping, "+2 more" -- over a stand-in for
// "another app". Nothing is sent anywhere.

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
const out = resolve(process.argv[2] ?? join(tmpdir(), 'dock.png'))
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))
const cat = (await readFile(join(DESKTOP, 'resources/pets/hoodie-cat/spritesheet.webp'))).toString('base64')

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TeammateBot } from ${src('components/TeammateBot.tsx')}

const CAT = ${JSON.stringify(cat)}
window.desktop = { readPetSheet: async () => ({ ok: true, data: { bytes: Uint8Array.from(atob(CAT), (c) => c.charCodeAt(0)), rows: 11 } }) }

const rows = [
  { name: 'Juno', hue: 'violet', avatar: { headwear: 2, accessory: 0, mouth: 0, pet: { source: 'bundled', id: 'hoodie-cat' } }, activity: 'waiting', line: 'Needs you: approve writing tests/cart.test.ts', time: '', tone: 'amber' },
  { name: 'Wren', hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' } }, activity: 'working', line: 'Running the tests -- npm test', time: '2:14' },
  { name: 'Atlas', hue: 'blue', avatar: { headwear: 0, accessory: 1, mouth: 0, bot: { shape: 'ghost', face: 'eyes' } }, activity: 'thinking', line: 'Thinking', time: '0:41' },
  { name: 'Sable', hue: 'clay', avatar: { headwear: 3, accessory: 2, mouth: 1, bot: { shape: 'hopper', face: 'eyes' } }, activity: 'done', line: 'Done -- 3 files changed', time: 'just now', tone: 'done' }
]
const row = (r) => h('button', { key: r.name, style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', border: 0, borderRadius: 9, background: r.tone === 'amber' ? 'rgba(233,185,73,0.10)' : 'transparent', boxShadow: r.tone === 'amber' ? 'inset 0 0 0 1px rgba(233,185,73,0.35)' : 'none', color: 'var(--lc-text-primary)', font: '13px var(--lc-font-sans, system-ui)', textAlign: 'left', cursor: 'pointer' } },
  h(TeammateBot, { hue: r.hue, avatar: r.avatar, size: 34, activity: r.activity, presence: r.activity === 'done' ? 'online' : 'working', motion: 'subtle' }),
  h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } },
    h('span', { style: { fontWeight: 600 } }, r.name),
    h('span', { style: { color: r.tone === 'amber' ? 'var(--lc-amber)' : 'var(--lc-text-muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.line)),
  h('span', { style: { color: 'var(--lc-text-muted)', fontSize: 11, fontFamily: 'var(--lc-font-mono)', flex: 'none' } }, r.time))
function Dock() {
  return h('div', { style: { width: 330, padding: 6, borderRadius: 14, background: 'var(--lc-bg-window, #121316)', boxShadow: '0 18px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.08)' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px 6px', color: 'var(--lc-text-muted)', font: '10.5px var(--lc-font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'grab' } },
      h('span', null, 'Locust \u00b7 4 at work'), h('span', null, '\u2715')),
    rows.map(row),
    h('div', { style: { padding: '4px 10px 2px', textAlign: 'right', color: 'var(--lc-text-muted)', fontSize: 12 } }, '+2 more'))
}
function Page() {
  // A stand-in for another app in front: a pale document, the dock at its lower right.
  return h('div', { style: { position: 'relative', width: 980, height: 560, background: '#e9e7e2', overflow: 'hidden' } },
    h('div', { style: { position: 'absolute', left: 60, top: 40, width: 560, color: '#3b3a37', font: '15px Georgia, serif', lineHeight: 1.6 } },
      h('div', { style: { font: '600 22px Georgia, serif', marginBottom: 14 } }, 'Quarterly plan -- draft'),
      'Another app is in front. The dock sits at the lower right of the screen, over ordinary windows, while Locust is in the background and teammates are at work. Juno is waiting on you, so Juno is first and amber; Sable just finished and will leave in two minutes. One click on a row opens that conversation in Locust.'),
    h('div', { style: { position: 'absolute', right: 24, bottom: 24 } }, h(Dock)))
}
createRoot(document.getElementById('root')).render(h(Page))
`

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-dock-'))
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
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="margin:0;overflow:hidden"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
setTimeout(() => { process.stderr.write('look-dock: timed out\\n'); app.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 980, height: 560, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2500))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-dock: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
