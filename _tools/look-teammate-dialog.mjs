// The New teammate dialog, drawn with the app's own components and
// stylesheet, to LOOK at a design pass before shipping (0.565). Two
// pictures: its top, and scrolled to the pets.
//
//   node _tools/look-teammate-dialog.mjs <out.png> [--thumbnails <folder of <id>.webp>]
//
// --thumbnails stands in for openpets.dev: the pets' small pictures read from
// a folder (a profile's pets-cache/thumbnails); without it the tiles show
// their placeholders. Nothing is sent anywhere.

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
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--thumbnails') ?? join(tmpdir(), 'teammate-dialog.png'))
const folder = option('--thumbnails')
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

// The picks' ids, read from their list without running TypeScript.
const picksSource = await readFile(join(DESKTOP, 'src/shared/pet-picks.ts'), 'utf8')
const ids = [...picksSource.matchAll(/\{ id: '([a-z0-9-]+)'/g)].map((found) => found[1])
const thumbnails = {}
if (folder !== undefined) {
  for (const id of ids) {
    const bytes = await readFile(join(resolve(folder), `${id}.webp`)).catch(() => undefined)
    if (bytes !== undefined) thumbnails[id] = `data:image/webp;base64,${bytes.toString('base64')}`
  }
}

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { NewTeammateDialog } from ${src('components/NewTeammateDialog.tsx')}

const THUMBNAILS = ${JSON.stringify(thumbnails)}
window.desktop = {
  listPets: async () => ({ ok: true, data: { pets: [] } }),
  petThumbnail: async (id) => (THUMBNAILS[id] === undefined ? { ok: false, error: { code: 'PETS_UNAVAILABLE', message: 'not here' } } : { ok: true, data: { dataUrl: THUMBNAILS[id] } }),
  readPetSheet: async () => ({ ok: false, error: { code: 'PETS_UNAVAILABLE', message: 'not here' } }),
  openLink: async () => ({ ok: true })
}
createRoot(document.getElementById('root')).render(h(NewTeammateDialog, { onCancel: () => undefined, onCreate: () => undefined, error: undefined, mode: 'accept-edits' }))
`

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-dialog-'))
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
setTimeout(() => { process.stderr.write('look-teammate-dialog: timed out\\n'); app.exit(2) }, 60000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1120, height: 720, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2000))
  writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/, '-top.png'), (await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript("document.querySelector('.lc-pets')?.scrollIntoView({ block: 'center' })")
  await new Promise((r) => setTimeout(r, 1500))
  writeFileSync(${JSON.stringify(out)}.replace(/[.]png$/, '-pets.png'), (await win.webContents.capturePage()).toPNG())
  process.stdout.write('wrote -top and -pets beside ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-teammate-dialog: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
