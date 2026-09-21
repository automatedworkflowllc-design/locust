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

function App() {
  return (
    <>
      <h1>Orb samples — bigger asset, not a bigger raster</h1>
      <p className="sub">
        Left column is exactly what ships today (the 20 preset at 20px). The rest render the
        library&rsquo;s 64 preset into a bigger box, which is a downscale and stays sharp.
      </p>

      <h2>Every shape, as it ships today</h2>
      <table><tbody>
        {SHAPES.map(([state, shape, word]) => (
          <tr key={state}>
            <td><Live word={word} orb={<ThinkingOrb state={state} size={20} theme="dark" />} /></td>
            <td className="name">{shape}</td>
            <td className="name">{state}</td>
          </tr>
        ))}
      </tbody></table>

      <h2>The working row — today vs the 64 asset at four sizes</h2>
      <table>
        <thead><tr>
          <th>ships today · 20 @ 20px</th><th>64 @ 20px</th><th>64 @ 24px</th>
          <th>64 @ 26px</th><th>64 @ 28px</th>
        </tr></thead>
        <tbody><tr>
          <td><Live word="working" orb={<ThinkingOrb state="composing" size={20} theme="dark" />} /></td>
          <td><Live word="working" orb={<Big state="composing" box={20} />} /></td>
          <td><Live word="working" orb={<Big state="composing" box={24} />} /></td>
          <td><Live word="working" orb={<Big state="composing" box={26} />} /></td>
          <td><Live word="working" orb={<Big state="composing" box={28} />} /></td>
        </tr></tbody>
      </table>

      <h2>The thinking row — the other wavy sphere, same treatment</h2>
      <table><tbody><tr>
        <td><Live word="thinking" orb={<ThinkingOrb state="listening" size={20} theme="dark" />} /></td>
        <td><Live word="thinking" orb={<Big state="listening" box={20} />} /></td>
        <td><Live word="thinking" orb={<Big state="listening" box={24} />} /></td>
        <td><Live word="thinking" orb={<Big state="listening" box={26} />} /></td>
        <td><Live word="thinking" orb={<Big state="listening" box={28} />} /></td>
      </tr></tbody></table>

      <h2>Side by side with its neighbours, at 26px</h2>
      <p className="sub">The question is whether it still reads as one of a set.</p>
      <table><tbody><tr>
        <td><Live word="working" orb={<Big state="composing" box={26} />} /></td>
        <td><Live word="thinking" orb={<ThinkingOrb state="listening" size={20} theme="dark" />} /></td>
        <td><Live word="using a connector" orb={<ThinkingOrb state="solving" size={20} theme="dark" />} /></td>
        <td><Live word="using a tool" orb={<ThinkingOrb state="connecting" size={20} theme="dark" />} /></td>
      </tr></tbody></table>
    </>
  )
}

createRoot(document.getElementById('app')).render(<App />)
