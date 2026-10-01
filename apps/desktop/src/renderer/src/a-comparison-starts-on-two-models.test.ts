import { describe, expect, it } from 'vitest'

import type { PublicModel } from '../../shared/ipc.js'
import { defaultComparePicks } from './compareDefaults.js'

/**
 * A COMPARISON STARTS ON TWO MODELS, EACH ITS OWN DROPDOWN (0.460).
 *
 * Arena opens Side by Side with two models already chosen. Colin,
 * 2026-09-29: "do what arena.ai does where you can select the models with
 * two dropdowns". The two: what is in the box, what this person has run,
 * then the catalog -- the second from another maker when there is one.
 */
const model = (runtime: string, id: string, extra: Partial<PublicModel> = {}): PublicModel =>
  ({ runtime, id, displayName: id, description: '', supportedEfforts: [], ...extra }) as unknown as PublicModel

const base = {
  models: [model('claude', 'opus'), model('claude', 'sonnet'), model('codex', 'gpt-6-sol'), model('opencode', 'opencode/nemotron-3-ultra-free')],
  ready: () => true,
  refusal: () => undefined,
  label: (choice: { readonly model: string }) => choice.model
}

describe('the two a comparison starts on', () => {
  it('are what is in the box, then another maker this person has run', () => {
    const picks = defaultComparePicks({ ...base, current: { runtime: 'claude', model: 'opus' }, recent: ['claude:sonnet', 'codex:gpt-6-sol'] })
    expect(picks.map((pick) => `${pick.runtime}:${pick.model}`)).toEqual(['claude:opus', 'codex:gpt-6-sol'])
    expect(picks[0]?.label).toBe('opus')
  })

  it('never start on "Account default", which names no model', () => {
    const picks = defaultComparePicks({ ...base, current: { runtime: 'claude', model: 'account-default' }, recent: ['claude:account-default', 'claude:sonnet'] })
    expect(picks.map((pick) => pick.model)).not.toContain('account-default')
    expect(picks[0]?.model).toBe('sonnet')
  })

  it('skip a model that cannot join, or whose runtime is not ready', () => {
    const picks = defaultComparePicks({
      ...base,
      current: { runtime: 'claude', model: 'opus' },
      recent: ['codex:gpt-6-sol'],
      ready: (runtime) => runtime !== 'codex',
      refusal: (choice) => (choice.model === 'opus' ? 'It cannot edit here.' : undefined)
    })
    expect(picks.map((pick) => `${pick.runtime}:${pick.model}`)).toEqual(['claude:sonnet', 'opencode:opencode/nemotron-3-ultra-free'])
  })

  it('are two of one maker when only one is ready, and none when fewer than two can join', () => {
    expect(defaultComparePicks({ ...base, current: undefined, recent: [], ready: (runtime) => runtime === 'claude' }).map((pick) => pick.model)).toEqual(['opus', 'sonnet'])
    expect(defaultComparePicks({ ...base, current: undefined, recent: [], models: [model('claude', 'opus')] })).toEqual([])
  })

  it('stay free when the first is free (0.515): a free teammate is not compared against a paid model nobody chose', () => {
    const models = [model('opencode', 'opencode/mimo-v2.6-flash-free'), model('codex', 'gpt-6.1-sol'), model('opencode', 'opencode/longcat-2.5-preview-free')]
    const picks = defaultComparePicks({ ...base, models, current: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free' }, recent: [] })
    expect(picks.map((pick) => pick.model)).toEqual(['opencode/mimo-v2.6-flash-free', 'opencode/longcat-2.5-preview-free'])
    // With no second free model, another maker as before.
    const lone = defaultComparePicks({ ...base, models: models.slice(0, 2), current: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free' }, recent: [] })
    expect(lone.map((pick) => pick.model)).toEqual(['opencode/mimo-v2.6-flash-free', 'gpt-6.1-sol'])
  })

  it('take, as the second free one, a free model that has answered here over the first listed (0.517)', () => {
    const models = [model('opencode', 'opencode/mimo-v2.6-flash-free'), model('opencode', 'opencode/ling-3.0-flash-fin-free'), model('opencode', 'opencode/muse-spark-1.3-contributor-free')]
    const current = { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free' } as const
    // Ling was tried (and failed) most recently; Muse is the one that answered.
    const picks = defaultComparePicks({ ...base, models, current, recent: ['opencode:opencode/ling-3.0-flash-fin-free'], answered: ['opencode/muse-spark-1.3-contributor-free'] })
    expect(picks.map((pick) => pick.model)).toEqual(['opencode/mimo-v2.6-flash-free', 'opencode/muse-spark-1.3-contributor-free'])
    // Nothing answered yet: the next free one, as before.
    const fresh = defaultComparePicks({ ...base, models, current, recent: [] })
    expect(fresh.map((pick) => pick.model)).toEqual(['opencode/mimo-v2.6-flash-free', 'opencode/ling-3.0-flash-fin-free'])
  })

  it('leave out older models and the person\'s own', () => {
    const picks = defaultComparePicks({ ...base, current: undefined, recent: [], models: [model('claude', 'old', { older: true }), model('opencode', 'mine', { own: true }), model('claude', 'opus'), model('codex', 'gpt-6-sol')] })
    expect(picks.map((pick) => pick.model)).toEqual(['opus', 'gpt-6-sol'])
  })
})
