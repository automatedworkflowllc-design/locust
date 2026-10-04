// Photograph the orb comparison at several moments, and record where every
// canvas sits, so the scoring reads exactly the pixels the screen shows.
//   electron orbshot.cjs <dir> <t,t,...>
const { app, BrowserWindow } = require('electron')
const { writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const [dir, times = '0.7,1.3,1.9,2.5'] = process.argv.slice(2)
app.whenReady().then(async () => {
  try {
    const template = readFileSync(join(dir, 'orb-compare.html'), 'utf8')
    const win = new BrowserWindow({ show: false, width: 560, height: 560, useContentSize: true })
    for (const t of times.split(',')) {
      const page = join(dir, `frame-${t}.html`)
      writeFileSync(page, template.replace('<script src="orb-compare.bundle.js"></script>', `<script>window.__T = ${Number(t)}</script><script src="orb-compare.bundle.js"></script>`))
      await win.loadFile(page)
      await new Promise((r) => setTimeout(r, 300))
      const rects = await win.webContents.executeJavaScript(
        "JSON.stringify({ dpr: window.__dpr, cells: [...document.querySelectorAll('canvas')].map((c) => { const b = c.getBoundingClientRect(); return { state: c.dataset.state, kind: c.dataset.kind, x: b.left, y: b.top, w: b.width, h: b.height } }) })"
      )
      const image = await win.webContents.capturePage()
      writeFileSync(join(dir, `frame-${t}.png`), image.toPNG())
      writeFileSync(join(dir, `frame-${t}.json`), rects)
      console.log('captured t =', t)
    }
  } catch (error) {
    console.log('failed', String(error))
  } finally {
    app.quit()
  }
})
