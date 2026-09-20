import { describe, expect, it } from 'vitest'

import { orbStateFor } from './missionView.js'

/**
 * The thinking orb's state is MAPPED to the work, never cycled.
 *
 * The design agent's ruling, 2026-09-20, is the reason this file exists and
 * the reason it is worth pinning rather than eyeballing:
 *
 *   "A person who learns `searching` means reading, then sees it during a
 *   shell command, now distrusts every indicator in the app."
 *
 * At 20px several of the library's nine states are the same shimmer, and that
 * is fine — the orb is not the sole carrier of meaning, because the row
 * already reads `shell · pnpm test billing`. The orb reinforces a fact the
 * text states. So it does not have to be legible on its own. **It has to not
 * contradict**, and that is exactly what is testable here.
 *
 * Which is why `orbStateFor` reads `detail.kind` — the same field
 * `activityEntries` reads to decide whether a row is a command, a subagent or
 * a file. One classification, two consumers, no way for them to disagree.
 */

const tool = (kind: string, name: string): { readonly kind: string; readonly name: string } => ({ kind, name })

describe('the orb maps to the work', () => {
  it('a shell command is working', () => {
    expect(orbStateFor(tool('shell', 'pnpm test billing'), false)).toBe('working')
  })

  it('a subagent is connecting', () => {
    expect(orbStateFor(tool('helper', 'Task'), false)).toBe('connecting')
  })

  it('reading a file is searching', () => {
    // The same word set the fold uses, which is why an Antigravity
    // `view_file` is a read here and not an edit.
    for (const name of ['read_file', 'view_file', 'Grep', 'listDirectory', 'search']) {
      expect(orbStateFor(tool('tool', name), false)).toBe('searching')
    }
  })

  it('a Plan-mode turn with nothing open is solving', () => {
    expect(orbStateFor(undefined, true)).toBe('solving')
  })
})

describe('the orb says nothing rather than something untrue', () => {
  it('writing a file has no orb', () => {
    /*
     * None of the four is true of a write. The library has five more states
     * and borrowing one -- `shaping`, say -- would be inventing a Locust
     * activity to fill a gap, which is the failure this project keeps
     * catching: a signal that looks like information and is not.
     */
    expect(orbStateFor(tool('edit', 'write_file'), false)).toBeUndefined()
  })

  it('waiting on the model with nothing reported has no orb', () => {
    // The line keeps its three dots there, which already mean exactly this.
    expect(orbStateFor(undefined, false)).toBeUndefined()
  })

  it('an unclassified tool has no orb', () => {
    expect(orbStateFor(tool('tool', 'todowrite'), false)).toBeUndefined()
  })

  it('only ever returns one of the four that are true here', () => {
    const four = new Set(['searching', 'working', 'connecting', 'solving'])
    const cases = [
      [tool('shell', 'ls'), false],
      [tool('helper', 'task'), false],
      [tool('tool', 'read'), false],
      [tool('edit', 'apply_patch'), false],
      [tool('tool', 'unknown_thing'), false],
      [undefined, true],
      [undefined, false]
    ] as const
    for (const [detail, plan] of cases) {
      const state = orbStateFor(detail, plan)
      if (state !== undefined) expect(four.has(state)).toBe(true)
    }
  })

  it('plan mode never overrides a tool that is actually running', () => {
    /*
     * A Plan-mode run still reads files and still shells out. If planning
     * won, the orb would say `solving` while the row said `shell` -- the
     * exact contradiction the ruling forbids.
     */
    expect(orbStateFor(tool('shell', 'git status'), true)).toBe('working')
    expect(orbStateFor(tool('tool', 'read_file'), true)).toBe('searching')
    expect(orbStateFor(tool('helper', 'Task'), true)).toBe('connecting')
  })
})
