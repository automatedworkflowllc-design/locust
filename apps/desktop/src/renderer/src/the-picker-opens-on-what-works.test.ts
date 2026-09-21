import { describe, expect, it } from 'vitest'

import { orderRouteRows } from './status.js'

/**
 * Sol's beta review, 2026-09-21, finding 2. Opened the model picker on a
 * machine where exactly one runtime worked, after two successful turns on it:
 *
 *     CODEX CLI · YOUR ACCOUNT   NOT INSTALLED
 *     CLAUDE CODE                NOT INSTALLED
 *     CURSOR AGENT               NOT INSTALLED
 *     …OpenCode, the only thing that works, below the fold
 *     GEMINI CLI                 PLANNED — "Not built yet."
 *
 * Three headings the person cannot use, and one thing that does not exist,
 * above the one runtime they had just sent two messages on.
 *
 * The cause was a single line: *"Groups keep the order discovery gave them;
 * only rows move."* Discovery's order has nothing to do with what is
 * installed. `runtimeListOrder` had fixed exactly this for the Settings list
 * on 2026-09-15 and its comment asserted *"The picker already groups
 * connected-first"* — it did not, and nobody checked. Which is the rule this
 * repo keeps paying for: verify a claim before acting on it, especially a
 * confident one.
 */
const row = (group: string, key: string, tag: string) => ({ key, group, tag })

describe('the picker opens on what works', () => {
  it('lifts the one runtime that can run above the three that cannot', () => {
    // Sol's screen, in discovery's order.
    const rows = [
      row('Codex CLI · your account', 'codex:gpt-5.6', 'NOT INSTALLED'),
      row('Claude Code', 'claude:sonnet', 'NOT INSTALLED'),
      row('Cursor Agent', 'cursor:composer', 'NOT INSTALLED'),
      row('Gemini CLI', 'gemini:flash', 'PLANNED'),
      row('OpenCode', 'opencode:ling-free', 'READY')
    ]
    // The one that works first; the rest alphabetical inside their bands,
    // which is why Claude Code now precedes Codex CLI. Sol saw them in
    // discovery order; discovery order is not an order anyone asked for.
    expect(orderRouteRows(rows, []).map((entry) => entry.group)).toEqual([
      'OpenCode',
      'Claude Code',
      'Codex CLI · your account',
      'Cursor Agent',
      'Gemini CLI'
    ])
  })

  it('sinks what does not exist below what merely is not installed', () => {
    const rows = [row('Gemini CLI', 'g', 'PLANNED'), row('Claude Code', 'c', 'NOT INSTALLED')]
    expect(orderRouteRows(rows, []).map((entry) => entry.group)).toEqual(['Claude Code', 'Gemini CLI'])
  })

  it('keeps a signed-out runtime above one that is not on the machine at all', () => {
    // Signing in is a press away; installing is a download. That ordering is
    // `RUNTIME_BAND`, shared with the Settings list so there is one answer.
    const rows = [row('Claude Code', 'c', 'NOT INSTALLED'), row('Codex CLI', 'x', 'SIGN IN')]
    expect(orderRouteRows(rows, []).map((entry) => entry.group)).toEqual(['Codex CLI', 'Claude Code'])
  })

  it('takes a group on its BEST row, not its first', () => {
    // One usable model is enough to keep a runtime up top — a runtime is not
    // demoted because the model discovery happened to list first is gone.
    const rows = [
      row('OpenCode', 'o1', 'NOT INSTALLED'),
      row('OpenCode', 'o2', 'READY'),
      row('Codex CLI', 'c1', 'SIGN IN')
    ]
    expect(orderRouteRows(rows, []).map((entry) => entry.group)[0]).toBe('OpenCode')
  })

  it('sorts alphabetically inside a band, the way Settings already does', () => {
    /*
     * This asserted DISCOVERY order, and Gemini's handoff pass caught it on a
     * machine with all seven runtimes present: Claude Code sorted below Codex
     * CLI in the same band purely because Codex answered its probe first.
     *
     * `runtimeListOrder`, which the Settings list uses, has sorted by display
     * name inside each band since 2026-09-15. Two lists of the same six
     * runtimes, two answers to "what comes first" — and the handoff brief I
     * wrote said "alphabetical inside each band" before I implemented the
     * other thing. The test agreed with the code instead of with either.
     */
    const rows = [row('Codex CLI', 'c', 'READY'), row('Claude Code', 'a', 'READY'), row('OpenCode', 'o', 'READY')]
    expect(orderRouteRows(rows, []).map((entry) => entry.group)).toEqual(['Claude Code', 'Codex CLI', 'OpenCode'])
  })

  it('does not move a group out of its band to satisfy the alphabet', () => {
    // Band always wins: a ready Zebra outranks a not-installed Apple.
    const rows = [row('Apple', 'a', 'NOT INSTALLED'), row('Zebra', 'z', 'READY')]
    expect(orderRouteRows(rows, []).map((entry) => entry.group)).toEqual(['Zebra', 'Apple'])
  })

  it('still sorts the active row to the top of its own group', () => {
    // The pre-existing rule, which the banding must not have broken: the row
    // the composer is pointing at is the last thing that should need finding.
    const rows = [
      row('OpenCode', 'o1', 'READY'),
      row('OpenCode', 'o2', 'ACTIVE'),
      row('Claude Code', 'c', 'NOT INSTALLED')
    ]
    expect(orderRouteRows(rows, []).map((entry) => entry.key)).toEqual(['o2', 'o1', 'c'])
  })
})
