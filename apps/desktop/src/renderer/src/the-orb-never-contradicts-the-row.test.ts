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
    expect(orbStateFor(tool('shell', 'pnpm test billing'), false)).toBe('solving')
  })

  it('a subagent is weaving, and a connector is connecting', () => {
    /*
     * They were both `connecting` and are now told apart, because they are
     * different claims. A connector LEFT THE MACHINE -- that is the fact the
     * permission chip exists to say. A subagent is work braided alongside
     * this one, on this machine, that this row cannot show you.
     *
     * Colin asked for every shipped orb to be used (2026-09-20), and this is
     * the honest place for `weaving`: the rarest of the work rows, which is
     * also where its sparseness at 20px costs least.
     */
    expect(orbStateFor(tool('helper', 'Task'), false)).toBe('weaving')
    expect(orbStateFor(tool('tool', 'gmail__send'), false, 'connector')).toBe('connecting')
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
  const WORK = new Set(['searching', 'listening', 'connecting', 'solving', 'composing', 'weaving', 'shaping'])

  it('writing a file is working -- a tool IS running, and that is all it says', () => {
    expect(orbStateFor(tool('edit', 'write_file'), false)).toBe('solving')
  })

  it('starting is breathing: alive, nothing back yet', () => {
    expect(orbStateFor(undefined, false, 'starting')).toBe('breathing')
    expect(orbStateFor(undefined, false)).toBe('breathing')
  })

  it('EVERY word change changes the orb', () => {
    /*
     * Colin, 2026-09-20: "when it transitions to another word, an orb switch
     * would be nice". An indicator that holds one shape across a state change
     * is an ornament, and the first version repeated itself on three of the
     * five transitions a run walks.
     *
     * Asserted as a set: the five words a run moves between must produce five
     * DIFFERENT orbs, so no future edit can quietly collapse two of them.
     */
    const words = ['starting', 'thinking', 'working', 'writing', 'connector'] as const
    const orbs = words.map((word) => orbStateFor(undefined, false, word))
    expect(new Set(orbs).size).toBe(words.length)
    expect(orbs).toEqual(['breathing', 'listening', 'composing', 'shaping', 'connecting'])
  })

  it('waiting on a model to speak is listening, and a model writing is composing', () => {
    // Honest on their own terms rather than merely distinct, which is the
    // difference between a mapping and a palette.
    expect(orbStateFor(undefined, false, 'thinking')).toBe('listening')
    // `shaping` for writing: a file being written IS being shaped, and it
    // puts the set's hardest silhouette on the briefest word a run says.
    expect(orbStateFor(undefined, false, 'writing')).toBe('shaping')
  })

  it('a step that says `tool` never shows the waiting ring', () => {
    /*
     * FOUND BY SPENDING. Codex reports a step AND its tools, so the live line
     * can be a step whose register is `tool` while no tool detail is open.
     * That fell through to `breathing`, whose label is "Thinking…", beside a
     * row reading "using a tool" -- sixteen consecutive samples of it on the
     * first paid drive, 2026-09-20.
     *
     * No free runtime streams steps, so no free drive could ever have seen
     * this. It is the one defect that needed the quota Colin released.
     */
    expect(orbStateFor(undefined, false, 'tool')).toBe('solving')
    expect(orbStateFor(undefined, false, 'tool')).not.toBe('breathing')
  })

  it('a connector call is connecting, because it left the machine', () => {
    expect(orbStateFor(tool('tool', 'gmail__send'), false, 'connector')).toBe('connecting')
  })

  it('an unclassified open tool is the generic tool orb, never a specific one', () => {
    const state = orbStateFor(tool('tool', 'todowrite'), false)
    expect(state).toBe('solving')
    expect(['searching', 'connecting']).not.toContain(state)
  })

  it('never claims a SPECIFIC kind of work that is not happening', () => {
    /*
     * WHICH ORBS ARE "SPECIFIC" MOVED, and the invariant did not.
     *
     * `solving` used to mean "this run is planning" and was therefore a claim
     * no fallback could make. Since 2026-09-20 it is the orb EVERY open tool
     * wears -- Colin asked for the rubik there -- so it now claims exactly
     * what the old fallback claimed: a tool is running, and the row says
     * which. It is the fallback.
     *
     * What stayed specific is `searching` (a READ tool is open) and
     * `connecting` (this left the machine). Those two are still only ever a
     * match, never a guess.
     */
    const specific = new Set(['searching', 'connecting'])
    const cases = [
      [tool('edit', 'apply_patch'), false],
      [tool('tool', 'unknown_thing'), false],
      [tool('shell', 'ls'), false],
      [undefined, false]
    ] as const
    for (const [detail, plan] of cases) {
      expect(specific.has(orbStateFor(detail, plan))).toBe(false)
    }
    expect(WORK.size).toBe(7)
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
    expect(orbStateFor(tool('shell', 'git status'), true)).toBe('solving')
    expect(orbStateFor(tool('tool', 'read_file'), true)).toBe('searching')
    expect(orbStateFor(tool('helper', 'Task'), true)).toBe('weaving')
  })
})
