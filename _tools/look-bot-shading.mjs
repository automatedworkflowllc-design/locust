// How Locust's bots look under bot-avatars' shadings, drawn with the app's
// own components and stylesheet, to LOOK at before changing them (0.565).
// Colin, 2026-10-03: "the libraries.dev github repo where we got the bot
// avatars added new shading options that look better than their current
// plastic tone, lemme know what you think".
//
//   node _tools/look-bot-shading.mjs <out.png> [--lib <bot-avatars package folder>] [--shading plastic|fabric]
//
// --lib draws with another copy of the library (an unpacked `npm pack`,
// kept outside the repository) in place of the one installed; --shading
// replaces Bot.tsx's own `shading: 'plastic'` for this picture only.
// Nothing is sent anywhere.

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
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && !['--lib', '--shading'].includes(args[i - 1])) ?? join(tmpdir(), 'bot-shading.png'))
const lib = option('--lib')
const shading = option('--shading') ?? 'plastic'
if (!['plastic', 'fabric'].includes(shading)) throw new Error('--shading takes plastic or fabric')
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split('\\').join('/'))

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { TeammateBot } from ${src('components/TeammateBot.tsx')}

const SHAPES = ['pill', 'pebble', 'droid', 'cat', 'ghost', 'blob', 'star', 'mech', 'cloud', 'alien']
const HUES = ['lime', 'blue', 'violet', 'amber', 'rose', 'teal', 'clay', 'sky', 'lime', 'violet']
const SIZES = [18, 32, 44, 96]
const label = (text) => h('div', { style: { color: '#8a8f98', font: '11px sans-serif', width: 54 } }, text)
function Row({ size }) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 12px', background: 'var(--lc-bg-sidebar)' } },
    label(size + ' px'),
    SHAPES.map((shape, i) => h('div', { key: shape, style: { width: Math.max(size, 30) + 6, display: 'flex', justifyContent: 'center' } },
      h(TeammateBot, { hue: HUES[i], avatar: { headwear: 1, accessory: 0, mouth: 0, bot: { shape, face: 'eyes' } }, size, activity: 'idle', presence: 'online', motion: 'subtle' }))))
}
function Page() {
  return h('div', { style: { padding: 12, background: 'var(--lc-bg-window, #121316)', display: 'flex', flexDirection: 'column', gap: 6 } },
    h('div', { style: { color: '#c9ccd2', font: '12px sans-serif', padding: '2px 12px' } }, ${JSON.stringify(`${shading}, bot-avatars ${lib === undefined ? 'as installed' : 'from ' + lib.split(/[\\/]/).slice(-2).join('/')}`)}),
    SIZES.map((size) => h(Row, { key: size, size })))
}
createRoot(document.getElementById('root')).render(h(Page))
`

// This picture only: Bot.tsx's shading, and the library it draws with.
const swap = {
  name: 'look-bot-shading',
  setup(build) {
    build.onLoad({ filter: /components[\\/]Bot\.tsx$/ }, async (found) => {
      const text = await readFile(found.path, 'utf8')
      if (!text.includes("shading: 'plastic',")) throw new Error("Bot.tsx no longer says shading: 'plastic' -- update this tool")
      return { contents: text.replace("shading: 'plastic',", `shading: '${shading}',`), loader: 'tsx' }
    })
  }
}

await mkdir(dirname(out), { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'locust-look-shading-'))
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
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
// Never left running: a failure, or a page that never draws, ends it.
setTimeout(() => { process.stderr.write('look-bot-shading: timed out\\n'); app.exit(2) }, 90000)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1300, height: 470, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  // Fabric's pile is baked on idle time after the first frame: give it time to land.
  await new Promise((r) => setTimeout(r, 6000))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-bot-shading: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
