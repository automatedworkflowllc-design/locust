import { describe, expect, it } from 'vitest'

import { effortDescription, effortFooter } from './effortLevels.js'

describe('describing a reasoning-effort level', () => {
  it('describes the levels runtimes actually list', () => {
    for (const level of ['low', 'medium', 'high', 'high-fast', 'max', 'fast']) {
      expect(effortDescription(level), level).toBeDefined()
    }
  })

  it('says NOTHING for a level it does not know', () => {
    // THE test. The levels come from the runtime, not from this app, so a
    // fixed table will meet words it has never seen. A confident sentence
    // under an invented meaning is worse than a bare word.
    expect(effortDescription('turbo-ultra')).toBeUndefined()
    expect(effortDescription('')).toBeUndefined()
  })

  it('talks about time and cost, not about how good the answer will be', () => {
    // "Thinks harder" is an unfalsifiable claim about an answer nobody has
    // seen. Time and money are what the person is actually trading, and they
    // can check both on the receipt afterwards.
    const all = ['low', 'medium', 'high', 'max'].map((level) => effortDescription(level) ?? '')
    expect(all.join(' ')).toMatch(/fast|slow|cheap|costlier/i)
    expect(all.join(' ')).not.toMatch(/better|smarter|best answer/i)
  })

  it('is not case sensitive, because runtimes are not consistent', () => {
    expect(effortDescription('HIGH')).toBe(effortDescription('high'))
  })
})

describe('the note under the menu', () => {
  it('says how Cursor actually takes an effort', () => {
    // Checkable, and it explains something the person can see: picking an
    // effort changes the model name in the composer.
    expect(effortFooter('cursor')).toMatch(/inside the model name/i)
  })

  it('draws no note for a runtime it has nothing true to say about', () => {
    for (const runtime of ['claude', 'codex', 'opencode', 'copilot']) {
      expect(effortFooter(runtime), runtime).toBeUndefined()
    }
  })
})
