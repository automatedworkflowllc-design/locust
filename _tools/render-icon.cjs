// Render the Locust mark to the PNG the window uses as its icon.
//
//   pnpm --filter @teammate/desktop exec electron ../../_tools/render-icon.cjs
//
// The mark exists as an SVG; Windows wants a raster for the title bar and the
// taskbar. Rather than adding an image toolchain for one file, Electron itself
// rasterises it: an offscreen window draws the mark on the shell's own dark
// ground and captures it at each size. Deterministic, and the same renderer
// that draws the app draws its icon.

const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
// The designer's app icon: the mark on its own rounded tile, drawn to fill
// the square. Rendered as-is, with no padding or tile of ours.
const MARK = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src', 'assets', 'locust-app-icon.svg')
const OUT_DIR = join(ROOT, 'apps', 'desktop', 'resources')
const SIZES = [512, 256]

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = readFileSync(MARK, 'utf8')
  mkdirSync(OUT_DIR, { recursive: true })
  // One window, captured at the largest size and scaled down: a second
  // offscreen window in the same process refuses to load anything at all.
  const size = SIZES[0]
  const window = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  // The icon file carries its own tile and inset; this page only sizes it.
  const html = `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
    .tile { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;
            box-sizing: border-box; padding: 0; }
    svg { width: 100%; height: 100%; }
  </style></head><body><div class="tile">${svg}</div></body></html>`
  const page = join(OUT_DIR, '.icon.html')
  writeFileSync(page, html)
  await window.loadFile(page)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  const image = await window.webContents.capturePage()
  for (const target of SIZES) {
    const scaled = target === size ? image : image.resize({ width: target, height: target, quality: 'best' })
    const path = join(OUT_DIR, target === 256 ? 'icon.png' : `icon-${target}.png`)
    writeFileSync(path, scaled.toPNG())
    console.log(`${path} ${scaled.getSize().width}x${scaled.getSize().height}`)
  }
  window.destroy()
  rmSync(page, { force: true })
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
