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

// The live line's real geometry, so a size is judged as a ROW and not as a
// picture: same gap, same mono label, same pill.
const Line = ({ state, word, box, preset }) => (
  <span className="row" style={{ gap: 8 }}>
    <span style={{ flex: 'none', display: 'grid', placeItems: 'center', width: box, height: box }}>
      {preset === 20
        ? <ThinkingOrb state={state} size={20} theme="dark" />
        : <Big state={state} box={box} />}
    </span>
    <span className="word">{word}</span>
  </span>
)

function App() {
  return (
    <>
      <h1>The 64 asset in the live line&rsquo;s own geometry</h1>
      <p className="sub">
        Left is what shipped through 0.221 — the library&rsquo;s 20px inline design in a 20px box.
        Right is the 64 asset painted into a 26px box, which is what the website shows.
        Judge the ROW, not the orb: does the line still read, and does the word still sit right?
      </p>
      <table>
        <thead><tr>
          <th>shape</th><th>0.221 · 20 preset @ 20px</th><th>64 asset @ 22px</th>
          <th>64 asset @ 26px</th><th>64 asset @ 30px</th>
        </tr></thead>
        <tbody>
          {SHAPES.map(([state, shape, word]) => (
            <tr key={state}>
              <td className="name">{shape}</td>
              <td><Line state={state} word={word} box={20} preset={20} /></td>
              <td><Line state={state} word={word} box={22} preset={64} /></td>
              <td><Line state={state} word={word} box={26} preset={64} /></td>
              <td><Line state={state} word={word} box={30} preset={64} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

createRoot(document.getElementById('app')).render(<App />)
