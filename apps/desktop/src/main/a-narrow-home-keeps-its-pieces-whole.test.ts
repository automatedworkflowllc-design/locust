import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A NARROW HOME KEEPS ITS PIECES WHOLE (0.405, fresh-eyes check; the 0.402
 * beta retest). With a conversation open beside Home at 1215x800, Home's pane
 * is ~427px: the team cards cut every name and role, the agent marks ran
 * under Show all, the chat box's effort and send stuck out into the panel
 * beside it, and -- once the cards stacked and the cover shrank -- the claim
 * outgrew its glass. drive-home-beside measures all four at three sizes.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('../renderer/src/shell.css')
const cover = read('../renderer/src/components/HomeCover.tsx')
const block = (opening: string): string => {
  const start = shell.indexOf(opening)
  if (start < 0) return ''
  let depth = 0
  for (let at = shell.indexOf('{', start); at < shell.length; at += 1) {
    if (shell[at] === '{') depth += 1
    if (shell[at] === '}') { depth -= 1; if (depth === 0) return shell.slice(start, at + 1) }
  }
  return ''
}

describe('a narrow Home', () => {
  it('stacks its team cards one to a row below 600px of section', () => {
    expect(block('.lc-hometeam {')).toContain('container-type: inline-size')
    const narrow = block('@container (max-width: 600px)')
    expect(narrow).toContain('.lc-hometeam .lc-hometeam__grid')
    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('wraps the agent marks rather than running them under Show all', () => {
    expect(block('.lc-agenthead__marks {')).toContain('flex-wrap: wrap')
  })

  it('lets the chat box’s right group wrap, and cuts the model name shorter, below 480px', () => {
    const narrow = block('@container (max-width: 480px)')
    expect(narrow).toContain('.lc-composer__controls .lc-composer__group + .lc-composer__group')
    expect(narrow).toContain('flex-wrap: wrap')
    expect(narrow).toContain('flex-shrink: 1')
    expect(narrow).toContain('.lc-composer__controls .lc-control__model')
  })

  it('sets the claim aside when it is wider than its glass, and keeps it measurable', () => {
    const aside = block('.lc-cover.is-claimless .lc-cover__claim {')
    expect(aside).toContain('position: absolute')
    expect(aside).toContain('visibility: hidden')
    expect(cover).toContain('setClaimFits(claim.getBoundingClientRect().width + 24 <= glass.clientWidth)')
    expect(cover).toContain("claimFits ? '' : ' is-claimless'")
  })
})
