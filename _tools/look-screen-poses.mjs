// Screen faces at set head turns and glances (0.561): each bot drawn through
// the app's own painter with a fixed pose, so a pose where an eye leaves its
// screen is drawn every time, not only when the idle rig happens to turn.
//
//   node _tools/look-screen-poses.mjs <out.png>      (EYES=">,▮" for other glyphs)
//
// Columns: yaw (radians, + turns right) and the rig's lookX. Nothing is sent.

import { mkdtemp, writeFile } from 'node:fs/promises'
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
const out = resolve(process.argv[2] ?? join(tmpdir(), 'glyph-eyes.png'))

const ENTRY = `
import { BOT_AVATAR_OVERSCAN, BotAvatarSim, autoInk, drawBotAvatarFrame, warmBotAvatarPlastic } from 'bot-avatars'
import { GLYPH_INK, bodyColorOf, outlineOf, visorOf, withGlyphEyes } from ${JSON.stringify(join(DESKTOP, 'src/renderer/src/components/Bot.tsx').split(String.fromCharCode(92)).join('/'))}

const SIZE = 100
const types = [['ghost', '#c7a6ff'], ['droid', '#5b8def'], ['cat', '#ff8c42'], ['swarm', '#7fd17a'], ['prompt', '#6fb7d6']]
const poses = [[-0.75, -4.5], [-0.4, -2], [0, 0], [0, -4.5], [0, 4.5], [0.4, 2], [0.75, 4.5]]
const root = document.getElementById('root')
root.style.cssText = 'display:grid;grid-template-columns:repeat(7,150px);gap:4px;padding:10px;font:11px sans-serif;color:#8a8f98'
for (const [type, color] of types) {
  for (const [yaw, lookX] of poses) {
    const cell = document.createElement('div')
    const canvas = document.createElement('canvas')
    const side = Math.round(SIZE * BOT_AVATAR_OVERSCAN)
    canvas.width = side; canvas.height = side
    canvas.style.cssText = 'width:' + side + 'px;height:' + side + 'px;margin:-25px'
    cell.append(canvas, Object.assign(document.createElement('div'), { textContent: type + ' yaw ' + yaw + ' look ' + lookX }))
    root.append(cell)
    const ctx = canvas.getContext('2d')
    const outline = outlineOf(type)
    const body = bodyColorOf(type, color)
    const path = new Path2D(outline.body)
    const parts = outline.parts === undefined ? undefined : new Path2D(outline.parts)
    warmBotAvatarPlastic(outline.key, path, SIZE)
    const sim = new BotAvatarSim(0.3, 'default')
    const pose = { ...sim.pose, yaw, lookX, eyeOpen: 1, blinkL: 0, blinkR: 0 }
    const painter = withGlyphEyes(ctx, () => [${JSON.stringify(process.env.EYES ?? '•,•')}.split(',')[0], ${JSON.stringify(process.env.EYES ?? '•,•')}.split(',')[1]], { ink: autoInk(body), screenOf: body, pixelsPerUnit: SIZE / 100 * outline.faceScale, visor: visorOf(outline, outline.face, path), eyeY: 1, faceAt: { x: outline.faceX, y: outline.faceY, scale: outline.faceScale } })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    painter.frame(pose, 0)
    drawBotAvatarFrame(ctx, SIZE, pose, { path, ...(parts ? { parts } : {}), ...(outline.partsDepth === undefined ? {} : { partsDepth: outline.partsDepth }), typeKey: outline.key, face: outline.face, faceX: outline.faceX, faceY: outline.faceY, faceScale: outline.faceScale, color: body, ink: GLYPH_INK, shading: 'plastic', dpr: 1, theme: 'dark', still: true })
  }
}
`

const work = await mkdtemp(join(tmpdir(), 'locust-glyph-eyes-'))
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
await writeFile(join(work, 'page.html'), '<!doctype html><html><body style="background:#16181c;margin:0"><div id="root"></div><script src="page.js"></script></body></html>', 'utf8')
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { backgroundThrottling: false } })
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  await new Promise((r) => setTimeout(r, 2500))
  const image = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(out)}, image.toPNG())
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + '\\n')
  app.quit()
})
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
