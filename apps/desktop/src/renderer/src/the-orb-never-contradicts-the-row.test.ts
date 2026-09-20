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

describe('where nothing is known, it says so rather than something untrue', () => {
  /*
   * THE FLOOR, added after Colin watched a real Cursor run sit at
   * `starting ••• 16s` with no orb at all: "shouldnt it also show up for any
   * thinking or activity regardless of calls?"
   *
   * It should. The first version drew an orb only while a tool was OPEN,
   * which on OpenCode -- a runtime that reports its tools when they finish --
   * meant never. `breathing` is the answer, and it was chosen by rendering
   * all nine at 20px: every work state is a cloud of dots and breathing is a
   * clean hollow ring, so it cannot be mistaken for any of them.
   *
   * The honesty claim is unchanged and is what these tests defend: the orb
   * never claims WORK that is not happening.
   */
  const WORK = new Set(['searching', 'working', 'connecting', 'solving'])

  it('writing a file is working -- a tool IS running, and that is all it says', () => {
    expect(orbStateFor(tool('edit', 'write_file'), false)).toBe('working')
  })

  it('starting and thinking are breathing: alive, nothing back yet', () => {
    expect(orbStateFor(undefined, false, 'starting')).toBe('breathing')
    expect(orbStateFor(undefined, false, 'thinking')).toBe('breathing')
    expect(orbStateFor(undefined, false)).toBe('breathing')
  })

  it('the orb CHANGES when starting becomes working', () => {
    /*
     * Colin, 2026-09-20, watching this feature's own drive: "when it went
     * from starting to working an orb change would have been nice". An
     * indicator that holds one shape across a state change is an ornament.
     */
    expect(orbStateFor(undefined, false, 'starting')).not.toBe(orbStateFor(undefined, false, 'working'))
    expect(orbStateFor(undefined, false, 'working')).toBe('working')
    expect(orbStateFor(undefined, false, 'writing')).toBe('working')
  })

  it('an unclassified open tool is working, never one of the specific three', () => {
    const state = orbStateFor(tool('tool', 'todowrite'), false)
    expect(state).toBe('working')
    expect(['searching', 'connecting', 'solving']).not.toContain(state)
  })

  it('never claims a SPECIFIC kind of work that is not happening', () => {
    /*
     * `working` claims only "a tool is running", which the row then names.
     * `searching`, `connecting` and `solving` each claim more than that, so
     * they are never a fallback -- only ever a match.
     */
    const specific = new Set(['searching', 'connecting', 'solving'])
    const cases = [
      [tool('edit', 'apply_patch'), false],
      [tool('tool', 'unknown_thing'), false],
      [tool('shell', 'ls'), false],
      [undefined, false]
    ] as const
    for (const [detail, plan] of cases) {
      expect(specific.has(orbStateFor(detail, plan))).toBe(false)
    }
    expect(WORK.size).toBe(4)
  })

  it('always returns something, so a live row is never bare', () => {
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
      expect(typeof orbStateFor(detail, plan)).toBe('string')
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
