// Does the app's rig draw every library bot exactly as the library does?
//
//   node _tools/probe-bots-drawn-alike.mjs
//
// 0.300 draws all twenty bots with the app's own rig (Bot.tsx), where the
// library's eighteen used to be its BotAvatar -- so they can hop and glance on
// cue. This draws each of the eighteen both ways at rest, at the sizes the app
// uses (the strip's 26 and the header's 32 at twice, the cover's 96), with no
// colour, a teammate's hue and another, each face: 324 pairs, compared pixel
// for pixel. Then the check is checked: every canvas must have a bot in it,
// and a pair that differs only in colour, face or shape must differ -- or a
// comparison of two blank canvases would pass.
//
// The page is the app's own Bot.tsx and the library, bundled with React from
// node_modules, in the app's own Electron. Nothing is sent anywhere.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const require = createRequire(join(DESKTOP, 'package.json'))
// esbuild is not the app's own dependency: it comes with vite, the app's bundler.
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const electron = require('electron')

const ENTRY = `
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { BotAvatar, botAvatarTypes } from 'bot-avatars'
import { Bot } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/components/Bot.tsx').replace(/\\/g, '/'))}

const cases = []
botAvatarTypes.forEach((type, index) => {
  for (const size of [52, 64, 96])
    for (const color of [undefined, '#5b8def', '#c7d45a'])
      for (const face of [undefined, 'mouth'])
        cases.push({ id: type + '-' + size + '-' + (color ?? 'own') + '-' + (face ?? 'own'), type, size, color, face, seed: 0.13 + (index % 7) * 0.11 })
})
// Exactly the props the app gave BotAvatar before 0.300 (Bot.tsx's DrawnBot).
const old = (c) => h(BotAvatar, { type: c.type, size: c.size, state: 'default', paused: true, theme: 'dark', interactive: false, 'aria-hidden': true, seed: c.seed, ...(c.color === undefined ? {} : { color: c.color, saturation: 1.15 }), ...(c.face === undefined ? {} : { face: c.face }) })
const now = (c) => h(Bot, { type: c.type, size: c.size, state: 'default', paused: true, seed: c.seed, ...(c.color === undefined ? {} : { color: c.color }), ...(c.face === undefined ? {} : { face: c.face }) })
const box = (c, cls, child) => h('span', { className: cls, style: { display: 'inline-flex', width: c.size, height: c.size, position: 'relative' } }, child)
createRoot(document.getElementById('root')).render(h('div', null, cases.map((c) => h('div', { key: c.id, className: 'pair', 'data-case': c.id, style: { display: 'flex', gap: 24, padding: 8 } }, box(c, 'old', old(c)), box(c, 'new', now(c))))))

const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
const differing = (a, b) => { const x = pixels(a), y = pixels(b); if (x.length !== y.length) return -1; let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) n += 1; return n }
const ink = (canvas) => { const d = pixels(canvas); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n }
window.compare = () => {
  const pairs = [...document.querySelectorAll('.pair')]
  const canvas = (id, side) => pairs.find((p) => p.dataset.case === id).querySelector('.' + side + ' canvas')
  const rows = pairs.map((p) => ({ id: p.dataset.case, differing: differing(p.querySelector('.old canvas'), p.querySelector('.new canvas')) }))
  return {
    pairs: rows.length,
    identical: rows.filter((r) => r.differing === 0).length,
    worst: rows.filter((r) => r.differing !== 0).slice(0, 12),
    leastInk: Math.min(...pairs.flatMap((p) => [ink(p.querySelector('.old canvas')), ink(p.querySelector('.new canvas'))])),
    colourApart: differing(canvas('ghost-96-own-own', 'old'), canvas('ghost-96-#5b8def-own', 'new')),
    faceApart: differing(canvas('ghost-96-own-own', 'old'), canvas('ghost-96-own-mouth', 'new')),
    shapeApart: differing(canvas('ghost-96-own-own', 'old'), canvas('droid-96-own-own', 'new'))
  }
}
`

const work = await mkdtemp(join(tmpdir(), 'locust-bots-alike-'))
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
await writeFile(join(work, 'page.html'), '<!doctype html><html><body style="background:#0e1013;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2500))
  const result = await win.webContents.executeJavaScript('JSON.stringify(window.compare())').catch((e) => JSON.stringify({ error: String(e) }))
  process.stdout.write(result + '\\n')
  app.quit()
})
`, 'utf8')

const output = await new Promise((resolve) => {
  let text = ''
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true })
  child.stdout.on('data', (chunk) => { text += chunk.toString('utf8') })
  child.on('close', () => resolve(text))
})
const line = output.split('\n').find((row) => row.trim().startsWith('{'))
if (line === undefined) {
  console.log('no result from the page:\n' + output)
  process.exit(1)
}
const result = JSON.parse(line)
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
check('every pair is drawn alike, pixel for pixel', result.pairs === 324 && result.identical === result.pairs, `${String(result.identical)} of ${String(result.pairs)} identical${result.worst.length > 0 ? `; ${JSON.stringify(result.worst)}` : ''}`)
check('every canvas has a bot in it', result.leastInk > 200, `the least ink in any canvas: ${String(result.leastInk)} pixels`)
check('and the comparison sees a difference when there is one', result.colourApart > 500 && result.faceApart > 50 && result.shapeApart > 500, `colour ${String(result.colourApart)}, face ${String(result.faceApart)}, shape ${String(result.shapeApart)} pixels apart`)
console.log(failures === 0 ? '\nBOTS DRAWN ALIKE' : `\nBOTS DRAWN ALIKE: ${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
