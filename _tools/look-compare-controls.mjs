// Render the app's comparison controls without discovery or a model call.
// node _tools/look-compare-controls.mjs <output.png>
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const desktop = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop')
const require = createRequire(join(desktop, 'package.json'))
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const out = resolve(process.argv[2] ?? 'compare-controls.png')
const src = (path) => JSON.stringify(join(desktop, 'src/renderer/src', path).replaceAll('\\', '/'))
const work = await mkdtemp(join(tmpdir(), 'locust-look-compare-'))
await writeFile(join(work, 'entry.jsx'), `
import ${src('tokens.css')}
import ${src('shell.css')}
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CompareView } from ${src('components/CompareView.tsx')}
const columns = ['a', 'b', 'c'].map(slot => ({ slot, name: 'Model ' + slot.toUpperCase(), runtime: 'opencode', runtimeName: 'OpenCode', turns: [], running: false, keepable: true, retryable: false, answer: 'Answer', state: 'done' }))
createRoot(document.getElementById('root')).render(<CompareView compare={{ compareId: 'cmp_look', prompt: 'Question', createdAt: '2026-10-03T00:00:00.000Z', slots: [] }} changeLines={{}} prompts={[]} columns={columns} keeping={false} onKeep={() => {}} onRetry={() => {}} judgeChoices={[{ key: 'one', label: 'Mimo V2.6 Flash Free' }, { key: 'two', label: 'Ling 3.0 Flash Fin Free', group: 'OpenCode' }]} onJudge={(key, criteria) => { window.judged = { key, criteria } }} />)
`, 'utf8')
await esbuild.build({ entryPoints: [join(work, 'entry.jsx')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', outfile: join(work, 'page.js'), define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' }, nodePaths: [join(desktop, 'node_modules')], absWorkingDir: desktop, logLevel: 'warning' })
await writeFile(join(work, 'page.html'), '<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head><body style="background:#16181c;margin:0;padding:16px"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1120, height: 720, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise(r => setTimeout(r, 1000))
  const result = await win.webContents.executeJavaScript(\`(() => {
    const select = document.querySelector('select[aria-label="The model that judges"]')
    const arrow = document.querySelector('.lc-compare__select > svg')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(select, 'two')
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return { appearance: getComputedStyle(select).appearance, arrow: !!arrow, pointer: getComputedStyle(arrow).pointerEvents, options: select.options.length }
  })()\`)
  await new Promise(r => setTimeout(r, 100))
  await win.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => b.textContent === 'Judge').click()")
  result.judged = await win.webContents.executeJavaScript('window.judged')
  writeFileSync(${JSON.stringify(out)}, (await win.webContents.capturePage()).toPNG())
  console.log(JSON.stringify(result))
  const ok = result.appearance === 'none' && result.arrow && result.pointer === 'none' && result.options === 2 && result.judged?.key === 'two'
  console.log(ok ? 'ALL 5 CHECKS PASSED' : 'CHECKS FAILED')
  app.exit(ok ? 0 : 1)
}).catch(error => { console.error(error); app.exit(1) })
`, 'utf8')
const code = await new Promise((done) => {
  const child = spawn(require('electron'), [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('error', error => { console.error(error); done(1) })
  child.on('close', done)
})
process.exit(code ?? 1)
