// Build the app icon: the PNGs the window and installer use, and the
// resources/icon.ico that electron-builder stamps into Locust.exe.
//
//   pnpm --filter @teammate/desktop exec electron ../../_tools/render-icon.cjs
//
// The artwork is the design agent's own "portrait, soft fade" app icon --
// the mark scaled so the wings run edge to edge and the antennae break the
// top, thickened so it survives 32px, and the abdomen faded out at the bottom
// so the crop ends in air rather than a slab. It arrives as PNGs at five
// sizes, so this script does not re-render it: earlier versions rasterised
// `brand/locust-app-icon-rounded.svg` and then guessed at a zoom, which is
// how the shipped icon came to be a differently-framed picture than the one
// the designer drew (Colin, 2026-09-06: "i believe you grabbed the wrong
// icon"). What it does is fill in the sizes Windows wants and were not
// provided, and pack the .ico.
//
// Electron does the scaling so no image toolchain is needed, and the same
// renderer that draws the app draws its icon.

const { app, nativeImage } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const SOURCE_DIR = join(ROOT, 'design', 'locust-desktop', 'brand', 'app-icon')
const OUT_DIR = join(ROOT, 'apps', 'desktop', 'resources')
/** The sizes the designer supplied, used as-is rather than scaled from another. */
const SUPPLIED = [1024, 512, 256, 64, 32]
/** Everything Windows asks for. Anything not supplied is scaled from the 1024. */
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

app.whenReady().then(() => {
  mkdirSync(OUT_DIR, { recursive: true })
  const largest = nativeImage.createFromBuffer(readFileSync(join(SOURCE_DIR, 'icon-1024.png')))
  if (largest.isEmpty()) throw new Error('The 1024 source icon did not decode')

  const imageFor = (size) => {
    if (SUPPLIED.includes(size)) {
      const supplied = nativeImage.createFromBuffer(readFileSync(join(SOURCE_DIR, `icon-${String(size)}.png`)))
      if (supplied.isEmpty()) throw new Error(`The ${String(size)} source icon did not decode`)
      return supplied
    }
    return largest.resize({ width: size, height: size, quality: 'best' })
  }

  const bySize = new Map()
  for (const size of SIZES) {
    const image = imageFor(size)
    bySize.set(size, image)
    const path = join(OUT_DIR, size === 256 ? 'icon.png' : `icon-${String(size)}.png`)
    writeFileSync(path, image.toPNG())
    console.log(`${path} ${image.getSize().width}x${image.getSize().height}${SUPPLIED.includes(size) ? ' (as supplied)' : ' (scaled)'}`)
  }

  const ico = packIco(
    ICO_SIZES.map((size) => ({
      size,
      data: size === 256 ? bySize.get(size).toPNG() : dibEntry(bySize.get(size), size)
    }))
  )
  const icoPath = join(OUT_DIR, 'icon.ico')
  writeFileSync(icoPath, ico)
  console.log(`${icoPath} ${String(ICO_SIZES.length)} images, ${String(ico.length)} bytes`)
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
