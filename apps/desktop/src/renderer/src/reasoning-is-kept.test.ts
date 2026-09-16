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

  it('draws no row when the runtime sent no text', () => {
    // Most runtimes send none, and a row reading "thought" with nothing in
    // it would promise something it does not have.
    const item = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning' }, '2026-09-16T10:00:20.000Z')
    ])
    expect(JSON.stringify(item ?? {})).not.toContain('"reasoning"')
  })

  it('ignores whitespace-only reasoning', () => {
    const item = fold([
      event('step.started', { stepKind: 'reasoning' }),
      event('step.completed', { stepKind: 'reasoning', message: '   ' }, '2026-09-16T10:00:20.000Z')
    ])
    expect(JSON.stringify(item ?? {})).not.toContain('"reasoning"')
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
