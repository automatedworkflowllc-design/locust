// The eyes MOVING (0.561): frames of live bots at work, in thought and done,
// a seventh of a second apart, to look at as a strip.
//
//   node _tools/look-eyes-moving.mjs <out.png>     -> out-00.png ... out-29.png  (TERMINAL=off for own eyes)
//        [--sizes 18,32,44,96] [--grounds sidebar,window] [--eyes thinking]
//        [--frames 30] [--every 140] [--from 1.2] [--dpr 1]          (PLUSH=on for plush)
//
// Colin, 2026-10-03: "thinking and working should have animations where the
// teammate looks alert, not flat lines". Bundled from the app's own Bot.tsx in
// the app's own Electron; nothing is sent.
//
// ON THE BOTS' OWN CLOCK (2026-10-05). Colin, of the dots: "i still noticed the
// eyes, specifically the dots are a bit wonky". A wonk is a frame that does
// not follow from the one before, so the frames are taken on a virtual clock:
// the page's time moves only when the tool steps it, a sixtieth of a second at
// a time as a 60 Hz screen's frames come, and Bot's clock draws every other
// one as it does in the app. Frames are exactly `--every` ms apart (33.3 is
// every frame the app draws), and the same run gives the same frames, so a
// before and an after can be laid side by side. The page also counts as in
// front: since 0.611 a face behind other windows holds still (windowPresence),
// and the capture window is hidden.
//
// One row of the five bots per size, on each ground asked for: `sidebar` and
// `window` are the two the app draws faces on (tokens.css); `page`, the
// default, is the ground this tool always used. `--eyes thinking` gives all
// five the dots, to look at those alone.
//
// `--trace <file.json>` writes, for each frame, every dot an eye is drawn as
// (a round stroke of no length: the screen's `•` and the rig's own eye) where
// it lands on the page and how wide and tall it is there, in CSS pixels -- so
// a dot that steps, drifts or changes size between frames is a number, not
// only a look -- and how many frames each canvas has drawn so far (`draws`):
// a face at rest draws none.
//
// `--activity <waiting|receiving|done|blocked|thinking|working|idle>` draws
// the five as teammates (TeammateBot) doing that, with the ring, the dot and
// the mood a teammate wears for it, instead of bots given their eyes;
// `--motion full` as the face you are talking to, `subtle` (the default) as
// the sidebar's.
//
// `--sequence thinking:3,working:3,done:2,waiting:3` draws the five as
// teammates going from one activity to the next, each held so many seconds on
// the page's clock: the CHANGES, to look at frame by frame (2026-10-05). The
// first is shown from the start, `--from` seconds before the first frame
// (0.5 by default here), and each change lands at the same moment of the
// page's time every run, so a before and an after line up frame for frame.
// Frames default to every one the app draws, through to the last activity's
// end. `--sequence` with no value takes that default.
//
// An entry can also do something to the faces while it holds (2026-10-05,
// faceLife.ts): `idle+hover:2` rests the pointer on each face, `idle+type:3`
// types to them (each face hears the composer). The page's timers run on its
// clock too, and the page counts as touched every few seconds, so a face's own
// moments come when they would in the app, the same every run.
//
// `--promo wide|tall` lays the page out as a film (2026-10-05): one teammate,
// the Settings legend's (FaceLegend.tsx), large on the window's ground, the
// name of each face under it as its new eyes come in, and locust.lol small
// below -- 1920x1080, or 1080x1920 with everything inside the Reels safe area
// (x 90-990, y 220-1400). With no --sequence it goes round the legend's faces
// from idle back to idle at rest, so the last frame is the first and the film
// loops: frames start once the screen has switched on and settled.
//
// `--pet <spritesheet.webp>` draws, at each size, Codex Buddy's sheet twice as
// teammates (2026-10-05, petScreens.ts): first AS DRAWN, the pet as every pet
// is shown (its sheet under another name, so no screen is measured for it),
// then WITH HIS SCREEN and his moves (petRoutines.ts). Same sheet, same
// clock, so the two line up frame for frame. The sheet is his maker's: give
// the copy on this computer (Locust's userData/pets/codex-buddy); nothing of
// it is kept, and nothing is sent.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
const args = process.argv.slice(2)
const VALUED = ['--sizes', '--grounds', '--eyes', '--frames', '--every', '--from', '--dpr', '--trace', '--activity', '--motion', '--sequence', '--promo', '--pet', '--bot', '--hue', '--side']
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const out = resolve(args.find((arg, i) => !arg.startsWith('--') && !VALUED.includes(args[i - 1])) ?? join(tmpdir(), 'glyph-eyes.png'))
const SIZES = (option('--sizes') ?? '110').split(',').map(Number)
const GROUND_OF = { page: '#16181c', sidebar: '#17191a', window: '#121415' }
const GROUNDS = (option('--grounds') ?? 'page').split(',')
const ACTIVITIES = ['waiting', 'receiving', 'done', 'blocked', 'thinking', 'working', 'idle', 'delegating', 'responding']
// --sequence: each activity and the seconds it is held, in order; with no value, the default.
const PROMO = option('--promo')
if (PROMO !== undefined && !['wide', 'tall', 'still'].includes(PROMO)) throw new Error('--promo takes wide, tall or still')
// The promo's teammate (Colin, 2026-10-05: "make the default teammate where you show off the emotions and any
// other promo the white ghost with terminal face, its clean"): the ghost in its own white -- no hue, as the cover
// and Settings draw it. --bot and --hue draw another (the first loop's: --bot droid --hue teal).
const PROMO_BOT = option('--bot') ?? 'ghost'
const PROMO_HUE = option('--hue') ?? null
// --promo still: one square frame, the face alone in the middle on a transparent ground, for a deck.
const STILL_SIDE = Number(option('--side') ?? '1000')
if (PROMO === 'still' && option('--sequence') === undefined) throw new Error('--promo still takes a --sequence of one activity, e.g. done:3')
// The legend's round (FaceLegend.tsx's FACE_LEGEND), idle held longer at each end for the loop's seam.
const PROMO_ROUND = 'idle:3.6,thinking:3.4,working:3,responding:2.8,done:2.4,waiting:3,receiving:2.6,blocked:2.8,idle:3'
const SEQUENCE_TEXT = option('--sequence') ?? (PROMO === undefined ? undefined : PROMO_ROUND)
const SEQUENCE = !args.includes('--sequence') && PROMO === undefined
  ? undefined
  : (SEQUENCE_TEXT === undefined || SEQUENCE_TEXT.startsWith('--') ? 'thinking:3,working:3,done:2,waiting:3' : SEQUENCE_TEXT).split(',').map((part) => {
      const [what, seconds] = part.split(':')
      const [activity, life] = what.split('+')
      if (!ACTIVITIES.includes(activity) || !(Number(seconds) > 0) || ![undefined, 'hover', 'type'].includes(life)) {
        throw new Error('--sequence takes activity[+hover|+type]:seconds entries, e.g. thinking:3,working:3,done:2,waiting:3')
      }
      return [activity, Number(seconds), life ?? null]
    })
const TYPES = SEQUENCE?.some(([, , life]) => life === 'type') === true
const HELD = SEQUENCE === undefined ? 0 : SEQUENCE.reduce((sum, [, seconds]) => sum + seconds, 0)
const EVERY = Number(option('--every') ?? (SEQUENCE === undefined ? '140' : String(1000 / 30)))
const FROM = Number(option('--from') ?? (SEQUENCE === undefined ? '1.2' : PROMO === undefined ? '0.5' : '2'))
// A sequence's frames run through to the end of its last activity, which began FROM seconds before the first frame.
const FRAMES = Number(option('--frames') ?? (SEQUENCE === undefined ? '30' : String(Math.floor(((HELD - FROM) * 1000) / EVERY) + 1)))
const DPR = option('--dpr')
const EYES = option('--eyes') ?? 'mixed'
const TRACE = option('--trace') === undefined ? undefined : resolve(option('--trace'))
const ACTIVITY = option('--activity')
const MOTION = option('--motion') ?? 'subtle'
if (ACTIVITY !== undefined && !ACTIVITIES.includes(ACTIVITY)) throw new Error('--activity takes a teammate activity')
if (ACTIVITY !== undefined && SEQUENCE !== undefined) throw new Error('--activity or --sequence, not both')
if (!['subtle', 'full'].includes(MOTION)) throw new Error('--motion takes subtle or full')
for (const ground of GROUNDS) if (!(ground in GROUND_OF)) throw new Error(`--grounds takes ${Object.keys(GROUND_OF).join(', ')}`)
if (SIZES.some((size) => !(size > 0)) || !(FRAMES > 0) || !(EVERY > 0) || !(FROM >= 0)) throw new Error('--sizes, --frames, --every and --from take numbers')
if (!['mixed', 'thinking'].includes(EYES)) throw new Error('--eyes takes mixed or thinking')
const src = (path) => JSON.stringify(join(DESKTOP, 'src/renderer/src', path).split(String.fromCharCode(92)).join('/'))
// --pet: his sheet's bytes, handed to the page as the host would hand them (readPetSheet).
const PET = option('--pet') === undefined ? undefined : (await readFile(resolve(option('--pet')))).toString('base64')
if (PET !== undefined && PROMO !== undefined) throw new Error('--pet or --promo, not both')

// The page's clock, installed before anything of the app runs: time moves only when the tool steps it.
const CLOCK = `
;(() => {
  let now = 1000
  // Where the steps asked to be, so frames --every ms apart land on the 60 Hz frame at or after each, without drift.
  let goal = now
  const queue = new Map()
  let next = 1
  const realFrame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => { const id = next++; queue.set(id, callback); return id }
  window.cancelAnimationFrame = (id) => { queue.delete(id) }
  Object.defineProperty(performance, 'now', { value: () => now, configurable: true })
  const wall = Date.now()
  Date.now = () => wall + now
  // In front, always (windowPresence): the capture window is hidden, and never focused.
  document.hasFocus = () => true
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true })
  // Timers on the page's clock too (a face's moments, the cover's rest): each runs when its time comes, in order.
  const timers = new Map()
  let timerId = 1
  window.setTimeout = (callback, ms = 0, ...rest) => { const id = timerId++; timers.set(id, { due: now + Math.max(0, Number(ms) || 0), callback, rest }); return id }
  window.setInterval = (callback, ms = 0, ...rest) => { const id = timerId++; const every = Math.max(1, Number(ms) || 0); timers.set(id, { due: now + every, every, callback, rest }); return id }
  window.clearTimeout = (id) => { timers.delete(id) }
  window.clearInterval = (id) => { timers.delete(id) }
  const tick = () => {
    now += 1000 / 60
    for (;;) {
      let first
      for (const [id, timer] of timers) if (timer.due <= now && (first === undefined || timer.due < timers.get(first).due)) first = id
      if (first === undefined) break
      const timer = timers.get(first)
      if (timer.every === undefined) timers.delete(first)
      else timer.due += timer.every
      if (typeof timer.callback === 'function') timer.callback(...timer.rest)
    }
    const due = [...queue.values()]
    queue.clear()
    for (const callback of due) callback(now)
  }
  // --trace: each dot an eye is drawn as, where it lands. A canvas's marks start again when it is cleared for a frame.
  let marks = []
  const proto = CanvasRenderingContext2D.prototype
  const { beginPath, moveTo, lineTo, stroke, fill, clearRect } = proto
  const paths = new WeakMap()
  // A path's points are placed by the transform they are added under, which need not be the one it is
  // stroked under: each is kept where it lands, with the origin of the transform it was added in.
  const placed = (context, x, y) => {
    const m = context.getTransform()
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f, ox: m.e, oy: m.f }
  }
  proto.beginPath = function () { paths.set(this, { n: 0 }); return beginPath.call(this) }
  proto.moveTo = function (x, y) {
    const path = paths.get(this) ?? { n: 0 }
    if (path.n === 0) Object.assign(path, { x0: x, y0: y, p0: placed(this, x, y) })
    path.n += 1
    paths.set(this, path)
    return moveTo.call(this, x, y)
  }
  proto.lineTo = function (x, y) {
    const path = paths.get(this) ?? { n: 0 }
    if (path.n === 1) Object.assign(path, { x1: x, y1: y, p1: placed(this, x, y) })
    path.n += 1
    paths.set(this, path)
    return lineTo.call(this, x, y)
  }
  // How many frames each canvas has drawn (a bot clears its canvas once a frame): a face at rest draws none.
  const drawn = new Map()
  proto.clearRect = function (...rect) {
    drawn.set(this.canvas, (drawn.get(this.canvas) ?? 0) + 1)
    marks = marks.filter((mark) => mark.canvas !== this.canvas)
    return clearRect.apply(this, rect)
  }
  // A mark: where the dot landed, where its eye's centre is (a glyph's motion is the difference), and how wide
  // and tall its weight is drawn by the transform it is stroked under.
  const mark = (context, kind, at) => {
    const m = context.getTransform()
    const r = context.lineWidth / 2
    marks.push({ canvas: context.canvas, kind, t: now, x: at.x, y: at.y, ox: at.ox, oy: at.oy, w: 2 * r * Math.hypot(m.a, m.c), h: 2 * r * Math.hypot(m.b, m.d), style: String(context.strokeStyle), alpha: context.globalAlpha })
  }
  proto.stroke = function (...args) {
    const path = paths.get(this)
    if (args.length === 0 && path !== undefined && path.n === 2 && this.lineCap === 'round' && Math.hypot(path.x1 - path.x0, path.y1 - path.y0) < 0.05 * Math.max(this.lineWidth, 1)) {
      // A round stroke of no length: a dot (the screen's •).
      mark(this, 'dot', { x: (path.p0.x + path.p1.x) / 2, y: (path.p0.y + path.p1.y) / 2, ox: path.p0.ox, oy: path.p0.oy })
    } else if (args.length === 1 && args[0] instanceof Path2D) {
      // The rig's own eye is a stroked path at the eye's centre; its weight tells it from the rest.
      mark(this, 'path', placed(this, 0, 0))
    }
    return stroke.apply(this, args)
  }
  proto.fill = function (...args) {
    const path = paths.get(this)
    if (args.length === 0 && path !== undefined && path.n >= 40 && this.fillStyle instanceof CanvasGradient) {
      // A screen (Bot.tsx's visor, traced point by point and filled with its gradient): the plane its eyes are drawn in.
      const m = this.getTransform()
      marks.push({ canvas: this.canvas, kind: 'visor', t: now, matrix: [m.a, m.b, m.c, m.d, m.e, m.f] })
    }
    return fill.apply(this, args)
  }
  // A hidden window's capture can be the frame before the last step: each step's number is set in
  // the top left pixel, beside the bots it was drawn with, and the tool takes the frame that shows it.
  let steps = 0
  const stamp = document.createElement('div')
  stamp.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;z-index:9;background:rgb(0,0,77)'
  window.__clock = {
    // Moves the page's time on by ms, a 60 Hz frame at a time, and resolves once it is painted.
    step: (ms) => {
      goal += ms
      while (now < goal - 1e-6) tick()
      for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = now }
      steps += 1
      if (!stamp.isConnected) document.body.append(stamp)
      // Sixteen levels a channel, far enough apart that one step is never read as the next.
      stamp.style.background = 'rgb(' + ((steps & 15) * 16 + 8) + ',' + (((steps >> 4) & 15) * 16 + 8) + ',77)'
      return new Promise((painted) => realFrame(() => realFrame(() => painted(steps))))
    },
    // This frame's marks in CSS pixels of the page, each with the index of its canvas.
    marks: () => {
      const canvases = [...document.querySelectorAll('canvas')]
      return marks.filter((m) => canvases.includes(m.canvas)).map((m) => {
        const box = m.canvas.getBoundingClientRect()
        const kx = box.width / m.canvas.width
        const ky = box.height / m.canvas.height
        if (m.kind === 'visor') {
          // The screen's own units to the page's CSS pixels: a dot's place on the screen is this, inverted.
          const [a, b, c, d, e, f] = m.matrix
          return { canvas: canvases.indexOf(m.canvas), kind: m.kind, t: m.t, matrix: [a * kx, b * ky, c * kx, d * ky, box.left + e * kx, box.top + f * ky] }
        }
        return { canvas: canvases.indexOf(m.canvas), kind: m.kind, t: m.t, x: box.left + m.x * kx, y: box.top + m.y * ky, ox: box.left + m.ox * kx, oy: box.top + m.oy * ky, w: m.w * kx, h: m.h * ky, style: m.style, alpha: m.alpha }
      })
    },
    now: () => now,
    // Frames each canvas has drawn so far, in the page's order of canvases.
    draws: () => [...document.querySelectorAll('canvas')].map((canvas) => drawn.get(canvas) ?? 0)
  }
})()
`

const ENTRY = `
import ${src('tokens.css')}
import ${src('shell.css')}
import { createElement as h, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Bot } from ${src('components/Bot.tsx')}
import { TeammateBot } from ${src('components/TeammateBot.tsx')}
import { setPlush, setTerminalFaces } from ${src('botLook.ts')}
${TYPES ? `import { noteTyping } from ${src('faceLife.ts')}` : 'const noteTyping = () => undefined'}
${PROMO === undefined ? '' : `import { legendName } from ${src('components/FaceLegend.tsx')}`}

setTerminalFaces(${JSON.stringify(process.env.TERMINAL !== 'off')})
setPlush(${JSON.stringify(process.env.PLUSH === 'on')})
const mixed = [['droid', '#5b8def', ['>', '▮']], ['ghost', '#c7a6ff', ['•', '•']], ['cat', '#ff8c42', ['>', '▮']], ['prompt', '#6fb7d6', ['•', '•']], ['hopper', '#7fd17a', ['^', '^']]]
// --activity: the five as teammates, in the hues closest to the colours above, wearing the dot that activity shows.
const ACTIVITY = ${JSON.stringify(ACTIVITY ?? null)} ?? undefined
const SEQUENCE = ${JSON.stringify(SEQUENCE ?? null)}
const HUES = ['blue', 'violet', 'clay', 'teal', 'lime']
const presenceOf = (activity) => ({ waiting: 'approval', blocked: 'blocked', working: 'working', delegating: 'working', thinking: 'working', responding: 'working' })[activity] ?? 'none'
// --sequence: the activity shown, read from the page's clock at every frame it steps and rendered there and then
// (flushSync), so each change lands at the same moment of the page's time every run.
let shownActivity = ACTIVITY ?? (SEQUENCE === null ? undefined : SEQUENCE[0][0])
const listeners = new Set()
// +hover: the pointer comes to rest on each face (as React hears it: over, then a move), and leaves again.
const point = (on) => {
  for (const face of document.querySelectorAll('.lc-bot')) {
    face.dispatchEvent(new PointerEvent(on ? 'pointerover' : 'pointerout', { bubbles: true, relatedTarget: on ? null : document.body }))
  }
  const row = document.querySelector('.lc-bot')?.getBoundingClientRect()
  if (on && row !== undefined) document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: row.left + row.width * 2.5, clientY: row.bottom + row.height * 0.6 }))
}
if (SEQUENCE !== null) {
  const start = performance.now()
  const ends = []
  let sum = 0
  for (const [, seconds] of SEQUENCE) ends.push((sum += seconds) * 1000)
  let life = SEQUENCE[0][2]
  let typedAt = -Infinity
  let touchedAt = start
  const check = () => {
    const at = ends.findIndex((end) => performance.now() - start < end)
    const [next, , nextLife] = SEQUENCE[at === -1 ? SEQUENCE.length - 1 : at]
    if (next !== shownActivity) {
      shownActivity = next
      flushSync(() => { for (const listener of listeners) listener(next) })
    }
    if (nextLife !== life) {
      if (life === 'hover') point(false)
      life = nextLife
      if (life === 'hover') point(true)
    }
    // +type: a key every 150 ms, as a person types.
    if (life === 'type' && performance.now() - typedAt >= 150) {
      typedAt = performance.now()
      noteTyping()
    }
    // Someone at the window: a key now and then, so the faces never rest for want of a person (the cover's rule).
    if (performance.now() - touchedAt >= 5000) {
      touchedAt = performance.now()
      window.dispatchEvent(new KeyboardEvent('keydown'))
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
  if (life === 'hover') setTimeout(() => point(true), 0)
}
const Teammate = (props) => {
  const [activity, setActivity] = useState(shownActivity)
  useEffect(() => {
    listeners.add(setActivity)
    return () => { listeners.delete(setActivity) }
  }, [])
  // A film's face wears no dot: at film size the app's 8 px dot is a speck, and the eyes and the ring say it all.
  return h(TeammateBot, { ...props, activity, presence: props.dotless === true ? 'none' : presenceOf(activity), hears: true })
}
const PROMO = ${JSON.stringify(PROMO ?? null)}
// --promo: the face's name as its new eyes come in, half a change-blink after the change (Bot's SWAP_S).
const Caption = ({ size }) => {
  const [name, setName] = useState(legendName(shownActivity))
  useEffect(() => {
    const changed = (next) => setTimeout(() => setName(legendName(next)), 130)
    listeners.add(changed)
    return () => { listeners.delete(changed) }
  }, [])
  return h('div', { style: { font: '500 ' + size + 'px var(--lc-font-ui, system-ui), sans-serif', color: '#e8e6e1', letterSpacing: '0.01em', lineHeight: 1.1 } }, name)
}
const PROMO_BOT = ${JSON.stringify(PROMO_BOT)}
const PROMO_HUE = ${JSON.stringify(PROMO_HUE)} ?? undefined
const Promo = () => {
  const tall = PROMO === 'tall'
  if (PROMO === 'still') {
    const side = Math.round(${STILL_SIDE} * 0.7)
    return h('div', { style: { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' } },
      h('span', { style: { display: 'inline-flex', width: side, height: side, position: 'relative' } },
        h(Teammate, { hue: PROMO_HUE, avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: PROMO_BOT, face: 'eyes' } }, size: side, motion: ${JSON.stringify(MOTION)}, teammateId: 'promo-face', dotless: true })))
  }
  const face = tall ? 600 : 460
  return h('div', { style: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: tall ? 'flex-start' : 'center', paddingTop: tall ? 392 : 0, gap: tall ? 110 : 64, background: '#121415' } },
    h('span', { style: { display: 'inline-flex', width: face, height: face, position: 'relative' } },
      h(Teammate, { hue: PROMO_HUE, avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: PROMO_BOT, face: 'eyes' } }, size: face, motion: ${JSON.stringify(MOTION)}, teammateId: 'promo-face', dotless: true })),
    h(Caption, { size: tall ? 76 : 60 }),
    h('div', { style: { position: 'absolute', bottom: tall ? 540 : 52, font: '400 ' + (tall ? 30 : 24) + 'px var(--lc-font-mono, ui-monospace), monospace', color: '#8a8f98', letterSpacing: '0.04em' } }, 'locust.lol'))
}
const PET = ${JSON.stringify(PET ?? null)}
if (PET !== null) {
  const bytes = Uint8Array.from(atob(PET), (c) => c.charCodeAt(0))
  window.desktop = { readPetSheet: async () => ({ ok: true, data: { bytes, rows: 9 } }) }
}
// --pet: as drawn (any other name: no screen is measured for it), then with his screen.
const PETS = ['as-drawn', 'codex-buddy']
const row = PET !== null ? PETS.map((id) => [id, null, null]) : ${JSON.stringify(EYES)} === 'thinking' ? mixed.map(([type, color]) => [type, color, ['•', '•']]) : mixed
const SIZES = ${JSON.stringify(SIZES)}
const GROUNDS = ${JSON.stringify(GROUNDS.map((name) => [name, GROUND_OF[name]]))}
const labelled = SIZES.length > 1 || GROUNDS.length > 1
const label = (text) => h('span', { style: { color: '#8a8f98', font: '11px sans-serif', width: 92, flex: 'none' } }, text)
createRoot(document.getElementById('root')).render(PROMO !== null ? h(Promo) : h('div', null,
  GROUNDS.map(([ground, colour]) => h('div', { key: ground, style: { background: colour } },
    SIZES.map((size) => h('div', { key: size, style: { display: 'flex', alignItems: 'center', gap: Math.max(24, size * 0.6), padding: Math.max(20, size * 0.4) + 'px 20px' } },
      labelled ? label(ground + ' ' + size) : null,
      row.map(([type, color, eyes], i) => h('span', { key: i, style: { display: 'inline-flex', width: size, height: size, position: 'relative' } },
        PET !== null
          ? h(Teammate, { hue: 'blue', avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' }, pet: { source: 'gallery', id: type } }, size, motion: ${JSON.stringify(MOTION)}, teammateId: 'look-pet-' + size })
          : shownActivity === undefined
          ? h(Bot, { type, size, color, seed: 0.15 + i * 0.11, jumpEvery: 0, eyes })
          : h(Teammate, { hue: HUES[i], avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: type, face: 'eyes' } }, size, motion: ${JSON.stringify(MOTION)}, teammateId: 'look-' + i })))))))))
`

await mkdir(dirname(out), { recursive: true })
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
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' },
  nodePaths: [join(DESKTOP, 'node_modules')],
  absWorkingDir: DESKTOP,
  logLevel: 'warning'
})
await writeFile(join(work, 'clock.js'), CLOCK, 'utf8')
await writeFile(join(work, 'page.html'), `<!doctype html><html class="lc-theme-dark"><head><link rel="stylesheet" href="page.css"></head>${PROMO === 'still' ? '<style>html,body{background:transparent!important}</style>' : ''}<body style="background:${PROMO === 'still' ? 'transparent' : GROUND_OF[GROUNDS[0]]};margin:0;overflow:hidden"><div id="root"></div><script src="clock.js"></script><script src="page.js"></script></body></html>`, 'utf8')
const widest = Math.max(...SIZES)
// Padding, the label and the gap after it, five bots and the gaps between, and room for the last one's overscan.
const labelled = SIZES.length > 1 || GROUNDS.length > 1
const across = PET === undefined ? 5 : 2
const width = PROMO === 'still' ? STILL_SIDE : PROMO === 'wide' ? 1920 : PROMO === 'tall' ? 1080 : 40 + (labelled ? 92 + Math.max(24, widest * 0.6) : 0) + across * widest + (across - 1) * Math.max(24, widest * 0.6) + widest * 0.3
const height = PROMO === 'still' ? STILL_SIDE : PROMO === 'wide' ? 1080 : PROMO === 'tall' ? 1920 : GROUNDS.length * SIZES.reduce((sum, size) => sum + size + 2 * Math.max(20, size * 0.4), 0)
const digits = String(FRAMES - 1).length
await writeFile(join(work, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
${DPR === undefined ? '' : `app.commandLine.appendSwitch('force-device-scale-factor', ${JSON.stringify(DPR)})`}
app.on('window-all-closed', () => {})
setTimeout(() => { process.stderr.write('look-eyes-moving: timed out\\n'); app.exit(2) }, 600000)
app.whenReady().then(async () => {
  // A film's frame is larger than a screen's work area, and Windows holds a window to that: drawn offscreen, it is not.
  const win = new BrowserWindow({ show: false, useContentSize: true, enableLargerThanScreen: true, width: ${Math.ceil(width)}, height: ${Math.ceil(height)},${PROMO === 'still' ? " transparent: true, backgroundColor: '#00000000'," : ''} webPreferences: { backgroundThrottling: false${PROMO === undefined ? '' : ', offscreen: true'} } })
  ${PROMO === undefined ? '' : `win.setContentSize(${Math.ceil(width)}, ${Math.ceil(height)})`}
  await win.loadFile(${JSON.stringify(join(work, 'page.html'))})
  // Mounted and drawn once, on the page's clock still at its start.
  await new Promise((r) => setTimeout(r, 600))
  const step = (ms) => win.webContents.executeJavaScript('window.__clock.step(' + ms + ')')
  // The frame that shows this step's number in its top left pixel (the clock's stamp), not one before it.
  const capture = async (stamped) => {
    for (let tries = 0; tries < 60; tries += 1) {
      const image = await win.webContents.capturePage()
      // The bitmap is BGRA or RGBA by platform: the stamp's blue (77) says which end red is at.
      const [p0, g, p2] = image.crop({ x: 0, y: 0, width: 1, height: 1 }).toBitmap()
      const [r, b] = Math.abs(p0 - 77) <= 1 ? [p2, p0] : [p0, p2]
      if (Math.abs(r - ((stamped & 15) * 16 + 8)) <= 4 && Math.abs(g - (((stamped >> 4) & 15) * 16 + 8)) <= 4 && Math.abs(b - 77) <= 4) return image
      await new Promise((r) => setTimeout(r, 16))
    }
    throw new Error('no frame showed step ' + stamped)
  }
  const frames = []
  let stamped = await step(${FROM * 1000})
  for (let f = 0; f < ${FRAMES}; f += 1) {
    if (f > 0) stamped = await step(${EVERY})
    const image = await capture(stamped)
    writeFileSync(${JSON.stringify(out)}.replace(/\\.png$/, '-' + String(f).padStart(${digits}, '0') + '.png'), image.toPNG())
    ${TRACE === undefined ? '' : `frames.push({ t: await win.webContents.executeJavaScript('window.__clock.now()'), marks: await win.webContents.executeJavaScript('window.__clock.marks()'), draws: await win.webContents.executeJavaScript('window.__clock.draws()') })`}
  }
  ${TRACE === undefined ? '' : `writeFileSync(${JSON.stringify(TRACE)}, JSON.stringify({ every: ${EVERY}, from: ${FROM}, sequence: ${JSON.stringify(SEQUENCE ?? null)}, eyes: ${JSON.stringify(EYES)}, terminal: ${JSON.stringify(process.env.TERMINAL !== 'off')}, plush: ${JSON.stringify(process.env.PLUSH === 'on')}, canvases: ${JSON.stringify(GROUNDS.flatMap((ground) => SIZES.flatMap((size) => (PET === undefined ? ['droid', 'ghost', 'cat', 'prompt', 'hopper'] : ['as-drawn', 'codex-buddy']).map((type, bot) => ({ ground, size, bot, type })))))}, frames }))`}
  process.stdout.write('wrote ' + ${JSON.stringify(out)} + ' (${FRAMES} frames, ${EVERY} ms apart)\\n')
  app.quit()
}).catch((error) => { process.stderr.write('look-eyes-moving: ' + String(error && error.stack || error) + '\\n'); app.exit(1) })
`, 'utf8')
await new Promise((done) => {
  const child = spawn(electron, [join(work, 'main.cjs')], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  child.on('close', done)
})
