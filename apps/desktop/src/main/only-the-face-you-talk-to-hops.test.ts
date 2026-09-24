import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * WHICH FACES HOP.
 *
 * Colin, 2026-09-23: "the one in the chat where you're speaking to, all that
 * movement is fine and great ... but its mirrored in the sidebar and the top,
 * lets tame those two down a bit". A teammate bot is subtle unless its call
 * site asks for `motion="full"`; this holds the list of sites that do, so a
 * third hopping copy of the same teammate is a decision and not a paste.
 * The behaviour of each level is held beside TeammateBot.
 */
const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : []
  })
}

describe('the motion a face asks for', () => {
  const asking = sources(RENDERER).flatMap((path) => {
    const text = readFileSync(path, 'utf8')
    // A prop, not TeammateBot's own `data-motion={motion}`.
    const full = text.match(/(?<![\w-])motion="full"/g)?.length ?? 0
    const computed = text.match(/(?<![\w-])motion=\{/g)?.length ?? 0
    return full + computed === 0 ? [] : [{ file: path.slice(RENDERER.length).replace(/\\/g, '/'), full, computed }]
  })

  it('is full in two places only: the face beside the live line, and the New teammate preview', () => {
    expect(asking).toEqual([
      { file: 'components/NewTeammateDialog.tsx', full: 1, computed: 0 },
      { file: 'components/ThreadItems.tsx', full: 1, computed: 0 }
    ])
  })

  it('is never computed, so the list above is the whole list', () => {
    expect(asking.every((site) => site.computed === 0)).toBe(true)
  })

  it('leaves the header and the sidebar subtle', () => {
    for (const file of ['App.tsx', 'components/Sidebar.tsx', 'components/Screens.tsx']) {
      expect(readFileSync(join(RENDERER, file), 'utf8')).not.toMatch(/\bmotion="full"/)
    }
  })
})

describe('the slight bounce', () => {
  const shell = readFileSync(join(RENDERER, 'shell.css'), 'utf8')
  const rule = (selector: string): string => {
    const start = shell.indexOf(`${selector} {`)
    return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
  }

  it('is a small lift and a longer rest', () => {
    expect(rule('.lc-bot.is-bouncing')).toContain('animation: lcBotBounce')
    // The whole block: since 0.305 its curve is written out in keyframes and stepped.
    const start = shell.indexOf('@keyframes lcBotBounce')
    const frames = shell.slice(start, shell.indexOf('\n}', start))
    expect(frames).toContain('translateY(-7%)')
    // Down again by 46%, and still from there: the rest is the longer part.
    expect(frames).toMatch(/46% \{\s*transform: translateY\(0\)/)
  })

  it('stops for a person who asked for less motion', () => {
    expect(shell).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.lc-bot__ring,\s*\.lc-bot\.is-floating,\s*\.lc-bot\.is-bouncing \{\s*animation: none;/)
  })
})
