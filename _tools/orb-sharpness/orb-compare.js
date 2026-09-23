// Draw each dense orb three ways at the live line's 26px, on the app's panel:
//   scaled -- what Locust does now: the 64 canvas, shrunk to 26 by CSS
//   native -- the same 64 design drawn by the engine straight at 26px
//   ideal  -- the same frame drawn 8x larger and averaged down exactly: the
//             best picture 26 device pixels can hold
// plus the 64 asset at its home size, for the eye. Each frame is drawn at a
// fixed time so all three show the same moment.
import { resolvePreset, MODE_DRAWS } from 'thinking-orbs/engine'

const STATES = ['composing', 'listening', 'solving', 'searching', 'connecting', 'weaving']
const BOX = 26
const DPR = Math.min(2, window.devicePixelRatio || 1)
const params = new URLSearchParams(location.search)
const TIME = Number(window.__T ?? params.get('t') ?? '1.3')

function drawAt(canvas, state, cssSize, backing, t) {
  const { mode, opts } = resolvePreset(state, 64)
  canvas.width = backing
  canvas.height = backing
  canvas.style.width = cssSize + 'px'
  canvas.style.height = cssSize + 'px'
  const ctx = canvas.getContext('2d')
  const k = backing / 64
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.clearRect(0, 0, 64, 64)
  MODE_DRAWS[mode](ctx, 64, t, true, opts)
  return ctx
}

function ideal(canvas, state, t) {
  const big = document.createElement('canvas')
  const scale = 8
  const side = BOX * DPR
  const ctx = drawAt(big, state, side * scale, side * scale, t)
  const src = ctx.getImageData(0, 0, side * scale, side * scale).data
  canvas.width = side
  canvas.height = side
  canvas.style.width = BOX + 'px'
  canvas.style.height = BOX + 'px'
  const out = canvas.getContext('2d')
  const img = out.createImageData(side, side)
  const n = scale * scale
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((y * scale + dy) * side * scale + (x * scale + dx)) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha; g += src[i + 1] * alpha; b += src[i + 2] * alpha; a += alpha
        }
      }
      const o = (y * side + x) * 4
      img.data[o] = a === 0 ? 0 : r / a
      img.data[o + 1] = a === 0 ? 0 : g / a
      img.data[o + 2] = a === 0 ? 0 : b / a
      img.data[o + 3] = (a / n) * 255
    }
  }
  out.putImageData(img, 0, 0)
}

const grid = document.getElementById('grid')
for (const state of STATES) {
  const row = document.createElement('div')
  row.className = 'row'
  const label = document.createElement('span')
  label.textContent = state
  row.appendChild(label)
  const cells = {}
  for (const kind of ['home', 'scaled', 'native', 'ss2', 'hq', 'ideal']) {
    const cell = document.createElement('div')
    cell.className = 'cell ' + kind
    const canvas = document.createElement('canvas')
    canvas.dataset.state = state
    canvas.dataset.kind = kind
    cell.appendChild(canvas)
    row.appendChild(cell)
    cells[kind] = canvas
  }
  grid.appendChild(row)
  drawAt(cells.home, state, 64, 64 * DPR, TIME)
  drawAt(cells.scaled, state, BOX, 64 * DPR, TIME)
  drawAt(cells.native, state, BOX, BOX * DPR, TIME)
  // Exactly twice the device pixels: the compositor's shrink is then a clean 2x2 average.
  drawAt(cells.ss2, state, BOX, 2 * BOX * DPR, TIME)
  // Drawn 4x large offscreen, then shrunk by the canvas with high-quality smoothing.
  {
    const big = document.createElement('canvas')
    drawAt(big, state, 4 * BOX, 4 * BOX * DPR, TIME)
    const c = cells.hq
    c.width = BOX * DPR
    c.height = BOX * DPR
    c.style.width = BOX + 'px'
    c.style.height = BOX + 'px'
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(big, 0, 0, c.width, c.height)
  }
  ideal(cells.ideal, state, TIME)
}
window.__dpr = DPR
