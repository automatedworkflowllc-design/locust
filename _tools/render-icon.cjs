// Render the Locust app icon: the PNGs the window and installer use, and the
// resources/icon.ico that electron-builder stamps into Locust.exe.
//
//   pnpm --filter @teammate/desktop exec electron ../../_tools/render-icon.cjs
//
// The icon exists as an SVG; Windows wants a raster for the title bar and the
// taskbar. Rather than adding an image toolchain for one file, Electron itself
// rasterises it: an offscreen window draws the icon and captures it at the
// largest size, and the smaller sizes are scaled from that. Deterministic, and
// the same renderer that draws the app draws its icon.

const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
// The designer's rounded tile: the white mark on the shell's own dark ground.
// Until 2026-09-06 this rendered the bare white mark on nothing, which Colin
// had asked for so it would read like other taskbar glyphs -- and on a light
// Windows taskbar a white glyph on transparency is simply not there ("it
// doesn't even show"). A tile reads on any ground, which is why app icons
// are tiles.
const ICON = join(ROOT, 'design', 'locust-desktop', 'brand', 'locust-app-icon-rounded.svg')
const OUT_DIR = join(ROOT, 'apps', 'desktop', 'resources')
// Every size Windows asks for, from the Start menu tile down to the title bar.
const SIZES = [512, 256, 128, 64, 48, 32, 16]
// What goes into the .ico, largest first. The 256 is stored as PNG, which
// Windows has read since Vista; the rest as plain 32-bit bitmaps, because
// GDI+ (and so some shells and .NET readers) refuse PNG data at those sizes.
const ICO_SIZES = [256, 128, 64, 48, 32, 16]

app.disableHardwareAcceleration()

/** A 32-bit BGRA bitmap entry: BITMAPINFOHEADER, bottom-up pixels, an empty AND mask. */
function dibEntry(image, size) {
  const pixels = image.toBitmap() // BGRA, top-down
  const stride = size * 4
  const maskStride = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR + AND heights
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(stride * size + maskStride * size, 20)
  const rows = []
  for (let y = size - 1; y >= 0; y -= 1) rows.push(pixels.subarray(y * stride, (y + 1) * stride))
  return Buffer.concat([header, ...rows, Buffer.alloc(maskStride * size)])
}

function packIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const directory = []
  let offset = 6 + 16 * entries.length
  for (const { size, data } of entries) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += data.length
  }
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)])
}

app.whenReady().then(async () => {
  const svg = readFileSync(ICON, 'utf8')
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
  // Transparent ground; the tile's own rounded corners are the icon's edge.
  const html = `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
    .tile { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; }
    svg { width: 100%; height: 100%; }
  </style></head><body><div class="tile">${svg}</div></body></html>`
  const page = join(OUT_DIR, '.icon.html')
  writeFileSync(page, html)
  await window.loadFile(page)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  const image = await window.webContents.capturePage()
  const scaledBySize = new Map()
  for (const target of SIZES) {
    const scaled = target === size ? image : image.resize({ width: target, height: target, quality: 'best' })
    scaledBySize.set(target, scaled)
    const path = join(OUT_DIR, target === 256 ? 'icon.png' : `icon-${target}.png`)
    writeFileSync(path, scaled.toPNG())
    console.log(`${path} ${scaled.getSize().width}x${scaled.getSize().height}`)
  }
  const ico = packIco(
    ICO_SIZES.map((target) => ({
      size: target,
      data: target === 256 ? scaledBySize.get(target).toPNG() : dibEntry(scaledBySize.get(target), target)
    }))
  )
  const icoPath = join(OUT_DIR, 'icon.ico')
  writeFileSync(icoPath, ico)
  console.log(`${icoPath} ${ICO_SIZES.length} images, ${ico.length} bytes`)
  window.destroy()
  rmSync(page, { force: true })
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
