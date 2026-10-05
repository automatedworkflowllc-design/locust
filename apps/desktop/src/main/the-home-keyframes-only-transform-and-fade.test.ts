import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const css = readFileSync(`${SRC}shell.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function frames(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    while (depth > 0 && end < source.length) {
      if (source[end] === '{') depth += 1
      if (source[end] === '}') depth -= 1
      end += 1
    }
    found.set(match[1], source.slice(start, end - 1))
  }
  return found
}

function violations(source: string): string[] {
  const named = frames(source)
  const used = new Set<string>()
  for (const rule of source.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
    if (!/\.lc-(?:cover|bot|lockup)[\w-]*/.test(rule[1])) continue
    for (const declaration of rule[2].matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) {
      for (const name of declaration[1].match(/\blc[\w-]+\b/g) ?? []) used.add(name)
    }
  }
  return [...used].flatMap((name) => {
    const body = named.get(name)
    if (body === undefined) return [`${name}: no keyframes found`]
    return [...body.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:/g)]
      .map((match) => match[1])
      .filter((property) => property !== 'transform' && property !== 'opacity')
      .map((property) => `${name}: ${property}`)
  })
}

describe('Home keyframes', () => {
  it('every keyframe used by the cover and bots only transforms or fades', () => {
    expect(frames(css).size).toBeGreaterThan(20)
    expect(css).toContain('animation: lcCoverZzz')
    expect(css).toContain('animation: lcLockupGlow')
    expect(violations(css)).toEqual([])
  })

  it('names the animation and property when a layout or paint animation slips in', () => {
    expect(violations('.lc-cover { animation: lcBad 1s; } @keyframes lcBad { to { top: 2px; filter: blur(1px); } }'))
      .toEqual(['lcBad: top', 'lcBad: filter'])
  })

  it('one class holds the cover and its descendants including pseudo-elements', () => {
    expect(css).toMatch(/\.lc-cover\.is-paused,\s*\.lc-cover\.is-paused \*,\s*\.lc-cover\.is-paused \*::before,\s*\.lc-cover\.is-paused \*::after\s*\{\s*animation-play-state: paused !important;/)
    expect(readFileSync(`${SRC}components/HomeCover.tsx`, 'utf8')).toContain("paused ? ' is-paused' : ''")
    // The runs going, not the whole map (the-cover-counts-only-work): every rebuild of the map kept Home awake.
    expect(readFileSync(`${SRC}App.tsx`, 'utf8')).toContain('coverActivity={coverWork}')
  })
})
