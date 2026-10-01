import { afterEach, describe, expect, it } from 'vitest'

import { modelDisplayName, rememberOwnModels, routeModelName } from './routeName.js'

/**
 * A MODEL HAS ONE NAME (0.528). drive-compare-answers on 0.527 picked Codex's
 * "GPT-6-Luna" in the picker and its column chip said "GPT-6 Luna". The chip
 * now takes the runtime's own spelling when it is the same name.
 */
afterEach(() => rememberOwnModels([]))

describe('a model has one name', () => {
  it('spells the id when no catalog has been read', () => {
    expect(modelDisplayName('codex', 'gpt-6-luna')).toBe('GPT-6 Luna')
  })

  it('takes the runtime\'s spelling of the same name', () => {
    rememberOwnModels([
      { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', runtime: 'codex' },
      { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', runtime: 'codex' }
    ])
    expect(modelDisplayName('codex', 'gpt-6-luna')).toBe('GPT-6-Luna')
    expect(routeModelName('codex', 'gpt-6.1-sol')).toBe('GPT-6.1-Sol')
  })

  it('never takes an identifier for a name (seen on the probe: "nemotron-3-ultra-free" in the chip)', () => {
    rememberOwnModels([
      { id: 'opencode/nemotron-3-ultra-free', displayName: 'nemotron-3-ultra-free', runtime: 'opencode' },
      { id: 'gpt-6-luna', displayName: 'gpt-6-luna', runtime: 'codex' }
    ])
    expect(modelDisplayName('opencode', 'opencode/nemotron-3-ultra-free')).toBe('Nemotron 3 Ultra Free')
    expect(modelDisplayName('codex', 'gpt-6-luna')).toBe('GPT-6 Luna')
  })

  it('leaves Locust\'s own "Account Default" as it reads everywhere (seen on the screen tour)', () => {
    rememberOwnModels([{ id: 'account-default', displayName: 'Account default', runtime: 'codex' }])
    expect(modelDisplayName('codex', 'account-default')).toBe('Account Default')
  })

  it('never takes a different name, and keeps runtimes apart', () => {
    rememberOwnModels([
      { id: 'gpt-6-luna', displayName: 'Fast and affordable', runtime: 'codex' },
      { id: 'gpt-6-sol', displayName: 'GPT-6-Sol', runtime: 'codex' }
    ])
    expect(modelDisplayName('codex', 'gpt-6-luna')).toBe('GPT-6 Luna')
    expect(modelDisplayName('copilot', 'gpt-6-sol')).toBe('GPT-6 Sol')
  })
})
