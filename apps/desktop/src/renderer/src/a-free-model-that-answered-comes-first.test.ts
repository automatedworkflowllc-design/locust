import { describe, expect, it } from 'vitest'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { PublicModel } from '../../shared/ipc.js'
import { freeModelsThatAnswered } from './missionView.js'
import { freeStartModel } from './status.js'

/**
 * The first free model can be down (0.517). On 2026-09-30 the catalogue's
 * first free model (Ling) answered "Endpoint is unavailable" all day while
 * others answered, and "Use a free model", a new route and Compare's second
 * pick all landed on it. A free model that finished a run here comes first;
 * the catalogue's first is for someone who has not run one yet.
 */
const model = (id: string, extra: Partial<PublicModel> = {}): PublicModel =>
  ({ id, runtime: 'opencode', displayName: id, description: '', supportedEfforts: [], ...extra } as unknown as PublicModel)
const listed = [model('opencode/paid-thing'), model('opencode/ling-3.0-flash-fin-free'), model('opencode/muse-spark-1.3-contributor-free'), model('opencode/mimo-v2.6-flash-free')]
const run = (modelId: string, phase: 'completed' | 'failed', at: string, runtime: MissionRuntimeId = 'opencode') =>
  ({ runtime, model: modelId, phase, lastUpdatedAt: at })

describe('a free model that answered here comes first', () => {
  it('takes the newest free model that finished a run, when the catalogue still lists it', () => {
    const answered = freeModelsThatAnswered([
      run('opencode/muse-spark-1.3-contributor-free', 'completed', '2026-09-29T10:00:00Z'),
      run('opencode/mimo-v2.6-flash-free', 'completed', '2026-09-30T10:00:00Z'),
      run('opencode/ling-3.0-flash-fin-free', 'failed', '2026-09-30T12:00:00Z')
    ])
    expect(answered).toEqual(['opencode/mimo-v2.6-flash-free', 'opencode/muse-spark-1.3-contributor-free'])
    expect(freeStartModel('opencode', listed, answered)).toBe('opencode/mimo-v2.6-flash-free')
  })

  it('a run that failed, was stopped, or was on a paid or other model does not count', () => {
    expect(freeModelsThatAnswered([
      run('opencode/ling-3.0-flash-fin-free', 'failed', '2026-09-30T12:00:00Z'),
      run('opencode/paid-thing', 'completed', '2026-09-30T12:00:00Z'),
      run('cursor/grok-free', 'completed', '2026-09-30T12:00:00Z', 'cursor')
    ])).toEqual([])
  })

  it('one no longer listed is passed over for the next that is', () => {
    const answered = ['opencode/gone-free', 'opencode/muse-spark-1.3-contributor-free']
    expect(freeStartModel('opencode', listed, answered)).toBe('opencode/muse-spark-1.3-contributor-free')
  })

  // Best first since 0.712 (status.FREE_MODELS_BEST_FIRST): Mimo, then Muse, then Ling 3.0, which it does not name.
  it('with nothing answered yet, the steadiest listed free model (it was the catalogue\'s first)', () => {
    expect(freeStartModel('opencode', listed, [])).toBe('opencode/mimo-v2.6-flash-free')
  })

  it('never a model of the person\'s own, even one named -free', () => {
    const own = [model('opencode/mine-free', { own: true } as Partial<PublicModel>), ...listed]
    expect(freeStartModel('opencode', own, ['opencode/mine-free'])).toBe('opencode/mimo-v2.6-flash-free')
  })
})
