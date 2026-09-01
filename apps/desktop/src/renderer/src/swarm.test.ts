import { describe, expect, it } from 'vitest'

import { swarmEffortFor } from './App.js'
import type { PublicModel } from '../../shared/ipc.js'

const MODELS: readonly PublicModel[] = [
  {
    id: 'sol',
    displayName: 'Sol',
    description: '',
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  },
  { id: 'luna', displayName: 'Luna', description: '', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'plain', displayName: 'Plain', description: '', supportedEfforts: [] }
]

describe('swarm effort', () => {
  it('uses the chosen effort when swarm is off', () => {
    expect(swarmEffortFor(MODELS, 'sol', false, 'medium')).toBe('medium')
    expect(swarmEffortFor(MODELS, 'sol', false, undefined)).toBeUndefined()
  })

  it("uses THIS model's maximum, not a fixed name", () => {
    // Sol reaches ultra and Luna does not. A fixed "ultra" would be an effort
    // Luna never advertised.
    expect(swarmEffortFor(MODELS, 'sol', true, undefined)).toBe('ultra')
    expect(swarmEffortFor(MODELS, 'luna', true, undefined)).toBe('max')
  })

  it('sends nothing for a model that reports no efforts', () => {
    expect(swarmEffortFor(MODELS, 'plain', true, 'high')).toBeUndefined()
  })

  it('sends nothing for a model it has never heard of', () => {
    expect(swarmEffortFor(MODELS, 'account-default', true, 'high')).toBeUndefined()
  })

  it('overrides a chosen effort rather than deferring to it', () => {
    // The composer shows the maximum while swarm is on, so what is SENT has to
    // match what is shown.
    expect(swarmEffortFor(MODELS, 'sol', true, 'low')).toBe('ultra')
  })
})
