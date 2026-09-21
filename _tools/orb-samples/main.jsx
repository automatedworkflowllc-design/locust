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

// The live line as 0.223 draws it: the 64 asset in a 26px box, the word at
// 14px in the UI face with four dots, and the library's own shimmer over it.
const Line = ({ state, word, dense }) => (
  <span className="row" style={{ gap: 10, padding: '6px 16px 6px 8px' }}>
    <span style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 26, height: 26 }}>
      {dense ? <Big state={state} box={26} /> : <ThinkingOrb state={state} size={20} theme="dark" />}
    </span>
    <span className="said" data-text={word}>{word}</span>
  </span>
)

const DENSE = new Set(['composing', 'listening', 'solving', 'searching', 'connecting', 'weaving'])
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1) + '….'

function App() {
  return (
    <>
      <h1>0.223 — the live line with the library&rsquo;s label and shimmer</h1>
      <p className="sub">
        Word at 14px in the UI face with their four dots, and their two-layer highlight:
        a solid word with a white band sliding over a copy of it, rather than transparent ink
        over a gradient. Outline shapes keep their own 20px drawing.
      </p>
      <table><tbody>
        {SHAPES.map(([state, shape, word]) => (
          <tr key={state}>
            <td className="name">{shape}</td>
            <td><Line state={state} word={cap(word)} dense={DENSE.has(state)} /></td>
          </tr>
        ))}
      </tbody></table>
    </>
  )
}

createRoot(document.getElementById('app')).render(<App />)
