// Colin: "Card only (Fix plan counts and workspace filtering; show that an
// unreported OpenCode command may have been running, with one warning.)."
// Passive preview using the actual card and app styles; sends nothing.
// node _tools/look-stopped-run-card.mjs <output-directory>
import './scratch-root.mjs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop')
const require = createRequire(join(desktop, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const electron = require('electron')
const out = resolve(process.argv[2] ?? join(tmpdir(), 'stopped-run-card'))
const work = await mkdtemp(join(tmpdir(), 'locust-look-stopped-card-'))
await mkdir(out, { recursive: true })
const src = (path) => JSON.stringify(join(desktop, 'src/renderer/src', path).split('\\').join('/'))
await writeFile(join(work, 'entry.jsx'), `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { CancellationCard } from ${src('components/CancellationCard.tsx')}
const examples = [
  ['Plan and finished tools', { settled: ['note-1.txt'], interrupted: [], neverStarted: 5, plan: { finished: 0, cutOff: 1, total: 6 }, toolsReportedWhenDone: true }],
  ['OpenCode without completed tools', { settled: [], interrupted: [], neverStarted: 0, toolsReportedWhenDone: true }],
  ['Finished plan without tools', { settled: [], interrupted: [], neverStarted: 0, plan: { finished: 1, cutOff: 0, total: 1 } }]
]
createRoot(document.getElementById('root')).render(h('main', { className: 'lc-thread', style: { padding: 24 } },
  examples.map(([name, summary]) => h('section', { key: name, style: { marginBottom: 24 } },
    h('p', { className: 'lc-mono' }, name), h(CancellationCard, { summary, stoppedAt: '05:00 PM' })))
))
`, 'utf8')
await esbuild.build({
  entryPoints: [join(work, 'entry.jsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  jsx: 'automatic', outfile: join(work, 'page.js'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' },
  nodePaths: [join(desktop, 'node_modules')], absWorkingDir: desktop, logLevel: 'warning'
})
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1209, height: 950, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  for (const width of [1209, 600]) {
    win.setSize(width, 950)
    await new Promise((resolve) => setTimeout(resolve, 800))
    writeFileSync(${JSON.stringify(out)} + '/' + width + '.png', (await win.webContents.capturePage()).toPNG())
  }
  app.quit()
}).catch((error) => { console.error(error); app.exit(1) })
`, 'utf8')
const code = await new Promise((resolve, reject) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('error', reject)
  child.on('close', resolve)
})
if (code !== 0) throw new Error(`Preview exited ${String(code)}`)
console.log(`Card previews: ${out}`)
