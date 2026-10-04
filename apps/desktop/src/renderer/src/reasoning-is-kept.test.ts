import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * A run that thought says what it thought.
 *
 * Reasoning was redacted at the adapter — Cursor replaced the text with
 * `[redacted]` before the record was rebuilt, and Codex redacted any
 * `reasoning|thinking|chain_of_thought` key **in the same branch as
 * `api_key`, `password` and `cookie`.** So the app could report that a model
 * had thought for fifty-eight seconds and nothing whatsoever about what.
 *
 * Colin, asked straight on 2026-09-16: *"i wanted to sacrifice nothing."*
 * The objection I first gave him was softer than I made it sound — his whole
 * ledger is about 15MB across 51 missions, and roughly doubling it costs
 * nothing against 78GB free. What it does cost is that a ledger sent to
 * somebody now carries the working-out too. That is a thing to know, not a
 * reason to throw the reasoning away.
 *
 * Secrets are still scrubbed from it, by the branch that always did.
 */

const at = '2026-09-16T10:00:00.000Z'
const event = (type: string, payload: Record<string, unknown>, when = at): NormalizedRuntimeEvent =>
  ({ id: `e-${type}-${when}`, runId: 'r', missionId: 'm', sequence: 1, occurredAt: when, sourceAdapter: 'cursor', type, payload }) as unknown as NormalizedRuntimeEvent

const fold = (events: readonly NormalizedRuntimeEvent[]) =>
  buildThread(events, { running: false, mayEdit: true, startedAt: at }).find((item) => item.type === 'activity') as
    | { readonly trace: { readonly rows: readonly { readonly kind: string; readonly output?: string }[] } }
    | undefined

describe('reasoning in the fold', () => {
  it('keeps the text the runtime sent', () => {
    const item = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning', message: 'Reading README.md to answer in one sentence.' }, '2026-09-16T10:00:20.000Z')
    ])
    const said = JSON.stringify(item ?? {})
    expect(said).toContain('Reading README.md')
  })

  /*
   * 0.489: WITH NO TEXT, THE LENGTH ALONE. It drew no row -- "a row reading
   * 'thought' with nothing in it would promise something it does not have" --
   * so a minute of thinking left no mark, where Claude Code and Antigravity
   * show "Thought for Ns" (DISPLAY-COVERAGE gap 6). The row now IS the length,
   * with nothing to open, so it promises nothing more than it has.
   */
  it('draws "thought for" with no text when the runtime sent none', () => {
    const item = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning' }, '2026-09-16T10:00:20.000Z')
    ])
    const details = (item as unknown as { details?: readonly { kind: string; output?: string; durationMs?: number }[] } | undefined)?.details ?? []
    const thought = details.find((row) => row.kind === 'reasoning')
    expect(thought?.durationMs).toBe(20_000)
    expect(thought?.output ?? '').toBe('')
  })

  it('and none for a thought under a second, or whitespace that never had a length', () => {
    const blink = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning', message: '   ' }, '2026-09-16T10:00:00.400Z')
    ])
    expect(JSON.stringify(blink ?? {})).not.toContain('"reasoning"')
  })

  it("draws Codex's reasoning item the same way", () => {
    const item = fold([
      event('step.started', { stepKind: 'item', itemType: 'reasoning', itemId: 'rs_1' }),
      event('step.completed', { stepKind: 'item', itemType: 'reasoning', itemId: 'rs_1' }, '2026-09-16T10:00:07.000Z')
    ])
    const details = (item as unknown as { details?: readonly { kind: string; durationMs?: number }[] } | undefined)?.details ?? []
    const thought = details.find((row) => row.kind === 'reasoning')
    expect(thought?.durationMs).toBe(7_000)
  })

  it('still reports how long it thought', () => {
    // The duration was the only thing reasoning ever contributed, and it is
    // still the thing a person waiting actually watches.
    const item = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning', message: 'x' }, '2026-09-16T10:00:52.000Z')
    ])
    expect(JSON.stringify(item ?? {})).toContain('thought')
  })
})

describe('reasoning is not a tool call', () => {
  /*
   * THE REGRESSION THIS EXISTS FOR, introduced and caught within the hour.
   *
   * Making reasoning an activity entry put it in `other`, which
   * `activitySummary` computes by subtraction -- so the fold read "6 tool
   * calls" over five, with `thought` listed among their names. Colin, from a
   * screenshot: "i remember it being able to list all the tool calls
   * individually like it does in claude code/cursor."
   *
   * Doubly wrong, because the same line already says `thought 24s` two
   * segments earlier: reported twice and counted once too often.
   */
  const detail = (kind: string, name: string) =>
    ({ kind, name, settled: true }) as never

  it('does not count thinking among the tool calls', async () => {
    const { activitySummary } = await import('./missionView.js')
    const withThought = activitySummary([
      detail('reasoning', 'thought'),
      detail('tool', 'mcp'),
      detail('tool', 'mcp')
    ])
    expect(withThought).toContain('2 tool calls')
    expect(withThought).not.toContain('3 tool calls')
  })

  it('says nothing about tool calls when a turn only thought', () => {
    // A run that thought and did nothing else ran no tools, and a summary
    // claiming one would be inventing work.
    return import('./missionView.js').then(({ activitySummary }) => {
      expect(activitySummary([detail('reasoning', 'thought')])).toBe('No tool activity')
    })
  })

  it('gives thinking its own row rather than folding it in with tools', async () => {
    /*
     * `foldedToolsText` gathers CONSECUTIVE foldable rows, and thinking sits
     * between tool calls constantly -- so left foldable it would not only be
     * named among them, it would break their runs in two and stop them
     * collapsing at all.
     */
    const { activityEntries } = await import('./missionView.js')
    const entries = activityEntries([
      detail('tool', 'mcp'),
      detail('reasoning', 'thought'),
      detail('tool', 'mcp')
    ])
    expect(entries.some((entry) => entry.kind === 'thought')).toBe(true)
    expect(entries.filter((entry) => entry.kind === 'thought')).toHaveLength(1)
  })
})
