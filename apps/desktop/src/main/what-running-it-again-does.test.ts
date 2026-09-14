import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Two scopes named for what they actually are.
 *
 * Astra's acceptance pass, 2026-09-14 — the first pass to reach routines,
 * and both findings are the same shape: a sentence that is true about the
 * request and silent about the state.
 *
 * **One.** A routine step asked a question, so the attempt was HELD:
 * `canContinue: false`, Routines offering acknowledge or abandon, and a
 * later Run starting from step one. The conversation said *"Answer it, then
 * run the routine again when you are ready"* — which reads as "carry on from
 * here". She deliberately did not answer and rerun, so no duplicate side
 * effect is claimed, and that restraint is the point: a person recovering
 * work that cannot be repeated needs to know whether the next action
 * continues or restarts BEFORE they press it. Her line is the ruling:
 * *durable state does not compensate for incomplete instructions beside the
 * answer box.*
 *
 * **Two.** Typing in the sidebar's search left the screen titled Missions
 * showing all twelve, while the sidebar said "No missions match that". One
 * word, two surfaces, one of them not responding — and from the page you are
 * looking at, the reasonable conclusion is that search does nothing. The
 * sidebar collapses missions into conversations; the Missions screen lists
 * missions. Naming each for what it holds is the smaller, truer fix, and the
 * different noun is itself the signal that the scopes differ.
 */

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('what a held routine tells you to do next', () => {
  const runner = read('./routine-runner.ts')

  it('does not say "run the routine again" as if it would continue', () => {
    // Code only. The comment above the fix QUOTES the old sentence, which is
    // how a fix explains itself -- the same trap the openLink guard hit.
    const code = runner
      .split(String.fromCharCode(10))
      .filter((line) => {
        const text = line.trimStart()
        return !text.startsWith('*') && !text.startsWith('//') && !text.startsWith('/*')
      })
      .join(String.fromCharCode(10))
    expect(code).not.toContain('then run the routine again when you are ready')
  })

  it('says the attempt cannot be continued', () => {
    expect(runner).toContain('this attempt cannot be continued')
  })

  it('says where the restart would begin, which is the fact that costs money', () => {
    // Non-idempotent work. "Again" is only safe if you know where from.
    expect(runner).toContain('starts from step 1')
  })

  it('names the surface holding the attempt', () => {
    expect(runner).toContain('under Routines')
  })

  it('still says to answer the question, which is genuinely the first step', () => {
    expect(runner).toContain('Answer it in that mission')
  })
})

describe('what the sidebar search says it searches', () => {
  const sidebar = read('../renderer/src/components/Sidebar.tsx')

  it('does not promise missions, which live on their own screen and do not filter', () => {
    expect(sidebar).not.toContain('placeholder="Search missions"')
    expect(sidebar).not.toContain('aria-label="Search missions"')
  })

  it('names what this list actually holds', () => {
    expect(sidebar).toContain('placeholder="Search conversations"')
    expect(sidebar).toContain('aria-label="Search conversations"')
  })

  it('agrees with itself when nothing matches', () => {
    // The empty state was the other half of the same claim: it said
    // "missions" too, from inside the list that holds conversations.
    expect(sidebar).toContain('No conversations match that.')
    expect(sidebar).not.toContain('No missions match that.')
  })
})
