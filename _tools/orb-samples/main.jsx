import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingOrb } from 'thinking-orbs'

/*
 * Samples for Colin, 2026-09-20: "we have bigger versions of these assets we
 * can size that we got from the github... i think we can get away with using
 * a slightly larger asset of that one, maybe send me samples before
 * shipping."
 *
 * He is right about what went wrong the first time. Scaling the 20px preset
 * up with a transform enlarges a 20px RASTER -- "you just cooked the
 * resolution". The library also ships a 64 preset, which is a different
 * drawing with more of everything, so the honest way to get a bigger orb is
 * to render 64 and let the browser paint it into a slightly bigger box. That
 * is a DOWNSCALE from 64, which is sharp.
 */

// A 64 preset painted into `box` CSS pixels. Below 64 this is a downscale.
function Big({ state, box }) {
  return (
    <span style={{ display: 'grid', placeItems: 'center', width: box, height: box }}>
      <span style={{ display: 'block', width: box, height: box, overflow: 'hidden' }}>
        <ThinkingOrb state={state} size={64} theme="dark" style={{ width: box, height: box }} />
      </span>
    </span>
  )
}

const Live = ({ state, word, orb }) => (
  <span className="row">{orb}<span className="word">{word}</span></span>
)

const SHAPES = [
  ['composing', 'ribbon', 'working'],
  ['listening', 'wave', 'thinking'],
  ['solving', 'rubik', 'using a connector'],
  ['searching', 'globe', 'using a tool'],
  ['connecting', 'web', 'using a tool'],
  ['weaving', 'braid', 'using a tool'],
  ['shaping', 'morph', 'writing'],
  ['breathing', 'ring', 'starting'],
  ['working', 'orbits', '(sidebar row)']
]

const PRESETS = {
  orbits: [1, 0.238], globe: [0.42, 0.105], rubik: [0.35, 0.088], wave: [0.341, 0.105],
  web: [1.35, 0.25], braid: [0.5, 0.1125], ribbon: [0.25, 0.051], ring: [0.25, 0.028],
  morph: [0.702, 0.53]
}
const DOTS = {
  orbits: [1, 2.4], globe: [1.15, 1.75], rubik: [1.05, 1.9], wave: [1, 1.6],
  web: [0.95, 1.52], braid: [1, 1.36], ribbon: [0.85, 1.073], ring: [0.956, 1.622],
  morph: [0.395, 1.011]
}

function App() {
  return (
    <>
      <h1>Are these the library&rsquo;s own drawings?</h1>
      <p className="sub">
        Yes — all 23 files are byte-identical to the published npm tarball, nothing is redrawn.
        What changed the LOOK is the library&rsquo;s own <b>20px preset</b>, which draws a small
        fraction of the points at a much bigger dot size. Column 1 is what Locust ships today.
        Column 2 is the same shape from the <b>64</b> asset — the drawing the website shows.
      </p>

      <table>
        <thead><tr>
          <th>shape</th>
          <th>ships today<br/>20 preset @ 20px</th>
          <th>64 asset @ 20px</th>
          <th>64 asset @ 24px</th>
          <th>64 asset @ 28px</th>
          <th>points kept at 20<br/>vs the 64 asset</th>
          <th>dot size</th>
        </tr></thead>
        <tbody>
          {SHAPES.map(([state, shape, word]) => {
            const [big, small] = PRESETS[shape]
            const [dbig, dsmall] = DOTS[shape]
            return (
              <tr key={state}>
                <td className="name">{shape} · {word}</td>
                <td><ThinkingOrb state={state} size={20} theme="dark" /></td>
                <td><Big state={state} box={20} /></td>
                <td><Big state={state} box={24} /></td>
                <td><Big state={state} box={28} /></td>
                <td className="tag">{Math.round((small / big) * 100)}% of them</td>
                <td className="tag">{(dsmall / dbig).toFixed(1)}&times; fatter</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

createRoot(document.getElementById('app')).render(<App />)
