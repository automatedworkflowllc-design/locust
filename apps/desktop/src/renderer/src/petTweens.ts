/**
 * IN-BETWEENS FOR A PET'S DRAWINGS (2026-10-05).
 *
 * Colin, of Codex Buddy's lifts: *"the original was just very choppy"*, and,
 * told his maker drew three to five drawings a lift and no more: *"since you
 * have both ends of the choppy frame, you can use your mega brain to fill in
 * the gaps"*. So between two of his drawings Locust draws its own in-betweens,
 * as a film's frame interpolation does: where each part of the first drawing
 * went in the second (flowBetween: coarse-to-fine block matching, its moves
 * smoothed with a median so a limb moves together), then each in-between's
 * pixels pulled from both drawings along that motion (inBetween: the
 * approximation Super SloMo uses for the flow at a moment between), weighted
 * by nearness in time and by which of them has paint there.
 *
 * Locust ships none of a pet's drawings (pet-picks.ts), and so none of these:
 * they are made on the person's own computer, from the sheet it downloaded,
 * the first time a pet moves between two of its drawings (petTweenSteps, run
 * a few milliseconds at a time), and kept for the session. Until they are
 * made, the drawings melt into each other as before.
 *
 * Measured on Codex Buddy's sheet, the motion found takes one drawing to within
 * a fifth to a half of the difference between the two as they stand; arms
 * swinging past his head ghost a little, which at his sizes, under his screen,
 * reads as motion.
 */

/** The in-betweens made for each pair of drawings: at these moments of the way from one to the other. */
export const TWEEN_MOMENTS: readonly number[] = [1 / 3, 2 / 3]

/**
 * Pyramid levels, coarsest first: how far a match is searched (in that
 * level's pixels), and the window it is judged over. The finest is the
 * drawing's size halved twice (FLOW_HALVINGS): at a pet's sizes motion needs
 * no more, and it is a sixteenth of the work; the in-betweens themselves are
 * drawn at full size.
 */
const LEVELS = 2
const RADIUS = [5, 2]
const WINDOW = [1, 2]
/** The finest level is the drawing halved this many times. */
const FLOW_HALVINGS = 2
/** Moving costs a little, so a flat patch stays put. */
const MOVE_COST = 0.002

interface Plane {
  readonly w: number
  readonly h: number
  /** Four channels a pixel: its colour against its own coverage, and its coverage. */
  readonly data: Float32Array
}

/** A drawing's pixels as the matching sees them: premultiplied colour, and coverage weighted half again. */
function planeOf(rgba: Uint8ClampedArray, w: number, h: number): Plane {
  const data = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i += 1) {
    const a = (rgba[i * 4 + 3] ?? 0) / 255
    data[i * 4] = ((rgba[i * 4] ?? 0) / 255) * a
    data[i * 4 + 1] = ((rgba[i * 4 + 1] ?? 0) / 255) * a
    data[i * 4 + 2] = ((rgba[i * 4 + 2] ?? 0) / 255) * a
    data[i * 4 + 3] = a * 1.5
  }
  return { w, h, data }
}

/** Half the size: each pixel the mean of four. */
function halved(plane: Plane): Plane {
  const w = Math.floor(plane.w / 2)
  const h = Math.floor(plane.h / 2)
  const data = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        const at = (yy: number, xx: number): number => plane.data[(yy * plane.w + xx) * 4 + c] ?? 0
        data[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y + 1, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x + 1)) / 4
      }
    }
  }
  return { w, h, data }
}

/** Each pixel's sum over a square window `r` round it (a summed-area table), edges repeated. */
function windowSums(values: Float32Array, w: number, h: number, r: number, table: Float64Array, out: Float32Array): Float32Array {
  const sw = w + 1
  for (let y = 0; y < h; y += 1) {
    let row = 0
    for (let x = 0; x < w; x += 1) {
      row += values[y * w + x] ?? 0
      table[(y + 1) * sw + x + 1] = (table[y * sw + x + 1] ?? 0) + row
    }
  }
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum = (table[y1 * sw + x1] ?? 0) - (table[y0 * sw + x1] ?? 0) - (table[y1 * sw + x0] ?? 0) + (table[y0 * sw + x0] ?? 0)
      // As if the window ran past the edge with the edge's own values: scaled to a whole window.
      out[y * w + x] = (sum * (2 * r + 1) * (2 * r + 1)) / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/** Rows a long pass does between yields, so no slice of the window's time runs long. */
const ROWS_A_STEP = 24

/** The median of each pixel's 5x5 neighbourhood: a limb's pixels move together. */
function* median5(values: Float32Array, w: number, h: number): Generator<void, Float32Array, void> {
  const out = new Float32Array(w * h)
  const box = new Float32Array(25)
  for (let y = 0; y < h; y += 1) {
    if (y % ROWS_A_STEP === 0) yield
    for (let x = 0; x < w; x += 1) {
      let n = 0
      for (let dy = -2; dy <= 2; dy += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + dy))
        for (let dx = -2; dx <= 2; dx += 1) box[n++] = values[yy * w + Math.min(w - 1, Math.max(0, x + dx))] ?? 0
      }
      box.sort()
      out[y * w + x] = box[12] ?? 0
    }
  }
  return out
}

/** Where each pixel of one drawing went in the other: its move across and down, in pixels. */
export interface Flow {
  readonly w: number
  readonly h: number
  readonly x: Float32Array
  readonly y: Float32Array
}

/**
 * The flow from drawing `a` to drawing `b` (RGBA, `w` x `h`), worked a step at
 * a time: each `yield` is a moment the caller may hand back to the window.
 */
export function* flowSteps(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): Generator<void, Flow, void> {
  let pa0 = planeOf(a, w, h)
  let pb0 = planeOf(b, w, h)
  for (let n = 0; n < FLOW_HALVINGS; n += 1) {
    pa0 = halved(pa0)
    pb0 = halved(pb0)
  }
  const pa: Plane[] = [pa0]
  const pb: Plane[] = [pb0]
  yield
  for (let level = 1; level < LEVELS; level += 1) {
    pa.push(halved(pa[level - 1] as Plane))
    pb.push(halved(pb[level - 1] as Plane))
  }
  let fx: Float32Array | undefined
  let fy: Float32Array | undefined
  let fw = 0
  let fh = 0
  for (let level = LEVELS - 1; level >= 0; level -= 1) {
    const A = pa[level] as Plane
    const B = pb[level] as Plane
    const { w: lw, h: lh } = A
    // The coarser level's flow, twice as far at twice the size; none at the coarsest.
    const gx = new Float32Array(lw * lh)
    const gy = new Float32Array(lw * lh)
    if (fx !== undefined && fy !== undefined) {
      for (let y = 0; y < lh; y += 1) {
        for (let x = 0; x < lw; x += 1) {
          const from = Math.min(fh - 1, y >> 1) * fw + Math.min(fw - 1, x >> 1)
          gx[y * lw + x] = (fx[from] ?? 0) * 2
          gy[y * lw + x] = (fy[from] ?? 0) * 2
        }
      }
    }
    const step = LEVELS - 1 - level
    const r = RADIUS[step] ?? 2
    const win = WINDOW[step] ?? 2
    const best = new Float32Array(lw * lh).fill(Number.POSITIVE_INFINITY)
    const bx = Float32Array.from(gx)
    const by = Float32Array.from(gy)
    // Reused for every shift tried, so no garbage is made while the window waits.
    const diff = new Float32Array(lw * lh)
    const table = new Float64Array((lw + 1) * (lh + 1))
    const sums = new Float32Array(lw * lh)
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let y = 0; y < lh; y += 1) {
          for (let x = 0; x < lw; x += 1) {
            const i = y * lw + x
            const sx = Math.min(lw - 1, Math.max(0, Math.round(x + (gx[i] ?? 0) + dx)))
            const sy = Math.min(lh - 1, Math.max(0, Math.round(y + (gy[i] ?? 0) + dy)))
            const j = (sy * lw + sx) * 4
            let d = 0
            for (let c = 0; c < 4; c += 1) {
              const e = (A.data[i * 4 + c] ?? 0) - (B.data[j + c] ?? 0)
              d += e * e
            }
            diff[i] = d
          }
        }
        const cost = windowSums(diff, lw, lh, win, table, sums)
        const penalty = MOVE_COST * (dx * dx + dy * dy)
        for (let i = 0; i < lw * lh; i += 1) {
          const c = (cost[i] ?? 0) + penalty
          if (c < (best[i] ?? 0)) {
            best[i] = c
            bx[i] = (gx[i] ?? 0) + dx
            by[i] = (gy[i] ?? 0) + dy
          }
        }
        yield
      }
    }
    fx = yield* median5(bx, lw, lh)
    fy = yield* median5(by, lw, lh)
    fw = lw
    fh = lh
    yield
  }
  // Back to the drawing's own size, blended between the finest level's pixels: as far again, at its size.
  const x = new Float32Array(w * h)
  const y = new Float32Array(w * h)
  if (fx !== undefined && fy !== undefined) {
    const scale = 2 ** FLOW_HALVINGS
    for (let row = 0; row < h; row += 1) {
      const sy = Math.min(fh - 1, Math.max(0, (row + 0.5) / scale - 0.5))
      const y0 = Math.floor(sy)
      const y1 = Math.min(fh - 1, y0 + 1)
      const ay = sy - y0
      for (let col = 0; col < w; col += 1) {
        const sx = Math.min(fw - 1, Math.max(0, (col + 0.5) / scale - 0.5))
        const x0 = Math.floor(sx)
        const x1 = Math.min(fw - 1, x0 + 1)
        const ax = sx - x0
        const at = (f: Float32Array): number =>
          ((f[y0 * fw + x0] ?? 0) * (1 - ax) + (f[y0 * fw + x1] ?? 0) * ax) * (1 - ay) + ((f[y1 * fw + x0] ?? 0) * (1 - ax) + (f[y1 * fw + x1] ?? 0) * ax) * ay
        x[row * w + col] = at(fx) * scale
        y[row * w + col] = at(fy) * scale
      }
      if (row % ROWS_A_STEP === 0) yield
    }
  }
  return { w, h, x, y }
}

/** A drawing's pixel at a place between pixels, its four neighbours blended. */
function bilinear(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: Float32Array): void {
  const cx = Math.min(w - 1.001, Math.max(0, x))
  const cy = Math.min(h - 1.001, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const ax = cx - x0
  const ay = cy - y0
  const i00 = (y0 * w + x0) * 4
  const i10 = i00 + 4
  const i01 = i00 + w * 4
  const i11 = i01 + 4
  for (let c = 0; c < 4; c += 1) {
    out[c] =
      ((rgba[i00 + c] ?? 0) * (1 - ax) * (1 - ay) + (rgba[i10 + c] ?? 0) * ax * (1 - ay) + (rgba[i01 + c] ?? 0) * (1 - ax) * ay + (rgba[i11 + c] ?? 0) * ax * ay) / 255
  }
}

/**
 * The drawing between `a` and `b` at moment `t` (0 `a`, 1 `b`), given the
 * flow each way: every pixel pulled from both along the flow estimated at it,
 * weighted by nearness in time and by which has paint there, its edge kept
 * crisp as the drawings' are.
 */
export function inBetween(a: Uint8ClampedArray, b: Uint8ClampedArray, ab: Flow, ba: Flow, t: number): Uint8ClampedArray {
  const steps = inBetweenSteps(a, b, ab, ba, t)
  for (;;) {
    const next = steps.next()
    if (next.done === true) return next.value
  }
}

function* inBetweenSteps(a: Uint8ClampedArray, b: Uint8ClampedArray, ab: Flow, ba: Flow, t: number): Generator<void, Uint8ClampedArray, void> {
  const { w, h } = ab
  const out = new Uint8ClampedArray(w * h * 4)
  const pa = new Float32Array(4)
  const pb = new Float32Array(4)
  const mixed = new Float32Array(4)
  for (let y = 0; y < h; y += 1) {
    if (y % ROWS_A_STEP === 0) yield
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x
      const f01x = ab.x[i] ?? 0
      const f01y = ab.y[i] ?? 0
      const f10x = ba.x[i] ?? 0
      const f10y = ba.y[i] ?? 0
      bilinear(a, w, h, x - (1 - t) * t * f01x + t * t * f10x, y - (1 - t) * t * f01y + t * t * f10y, pa)
      bilinear(b, w, h, x + (1 - t) * (1 - t) * f01x - t * (1 - t) * f10x, y + (1 - t) * (1 - t) * f01y - t * (1 - t) * f10y, pb)
      const wa = (1 - t) * (0.15 + (pa[3] ?? 0))
      const wb = t * (0.15 + (pb[3] ?? 0))
      const sum = wa + wb
      /*
       * WHERE THE TWO DISAGREE, A MELT, NOT A GUESS. Where both drawings, pulled
       * to this moment, show the same thing, the motion was found; where they
       * show different things (an arm swung past the body, coming from nowhere
       * in the other), it was not, and a guess there smears. So there the pixel
       * is the two drawings as they stand, melted (TWEEN_TRUST).
       */
      let apart = 0
      for (let c = 0; c < 4; c += 1) apart += Math.abs((pa[c] ?? 0) - (pb[c] ?? 0))
      const trust = Math.min(1, Math.max(0, 1 - (apart - TWEEN_TRUST.from) / (TWEEN_TRUST.to - TWEEN_TRUST.from)))
      const o = i * 4
      for (let c = 0; c < 4; c += 1) {
        const pulled = ((pa[c] ?? 0) * wa + (pb[c] ?? 0) * wb) / sum
        const melted = (((a[o + c] ?? 0) / 255) * (1 - t) + ((b[o + c] ?? 0) / 255) * t)
        mixed[c] = pulled * trust + melted * (1 - trust)
      }
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.round((mixed[c] ?? 0) * 255)
      out[o + 3] = Math.round(Math.min(1, Math.max(0, ((mixed[3] ?? 0) - 0.25) / 0.5)) * 255)
    }
  }
  return out
}

/** Both flows between two drawings, then an in-between at each of TWEEN_MOMENTS: a step at a time. */
export function* tweenSteps(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): Generator<void, readonly Uint8ClampedArray[], void> {
  const ab = yield* flowSteps(a, b, w, h)
  const ba = yield* flowSteps(b, a, w, h)
  const frames: Uint8ClampedArray[] = []
  for (const t of TWEEN_MOMENTS) frames.push(yield* inBetweenSteps(a, b, ab, ba, t))
  return frames
}

/** How far apart (summed over colour and coverage, 0-4) the two pulled drawings may be and still be trusted, fully and not at all. */
export const TWEEN_TRUST = { from: 0.35, to: 0.9 }

/** At most this long of the window's time at once, then a turn for everything else. */
export const TWEEN_SLICE_MS = 6

/** How long the work waits, while the window rests, before it looks again. */
export const TWEEN_RESTING_WAIT_MS = 1_000

/**
 * Runs `steps` a slice at a time between the window's own work (setTimeout),
 * and hands its result to `done`. Returns the way to stop it.
 *
 * NEVER WHILE LOCUST RESTS. While `resting` says so -- the window behind
 * others or hidden (windowPresence.ts) -- no slice runs: the work waits, and
 * goes on from where it was once the window is back in front.
 */
export function runInSlices<T>(
  steps: Generator<void, T, void>,
  done: (result: T) => void,
  now: () => number = () => performance.now(),
  resting: () => boolean = () => false
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const slice = (): void => {
    timer = undefined
    if (stopped) return
    if (resting()) {
      timer = setTimeout(slice, TWEEN_RESTING_WAIT_MS)
      return
    }
    const until = now() + TWEEN_SLICE_MS
    for (;;) {
      const next = steps.next()
      if (next.done === true) {
        done(next.value)
        return
      }
      if (now() >= until) break
    }
    timer = setTimeout(slice, 0)
  }
  timer = setTimeout(slice, 0)
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
