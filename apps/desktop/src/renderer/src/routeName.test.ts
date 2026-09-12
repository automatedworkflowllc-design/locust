import { describe, expect, it } from 'vitest'

import { modelDisplayName, shortRuntimeName } from './routeName.js'

describe('how a route reads on a chip', () => {
  it('says the three Colin named, exactly as he named them', () => {
    // The ask, verbatim: "it should just say Cursor / Grok 4.6 Claude /
    // Fable 5.1 Codex / GPT-6 Astra".
    expect(`${shortRuntimeName('cursor')} / ${modelDisplayName('cursor', 'cursor-grok-4.6')}`).toBe('Cursor / Grok 4.6')
    expect(`${shortRuntimeName('claude')} / ${modelDisplayName('claude', 'fable-5.1')}`).toBe('Claude / Fable 5.1')
    expect(`${shortRuntimeName('codex')} / ${modelDisplayName('codex', 'gpt-6-astra')}`).toBe('Codex / GPT-6 Astra')
  })

  it('keeps the hyphen only where the makers keep one', () => {
    expect(modelDisplayName('codex', 'gpt-5.6-luna')).toBe('GPT-5.6 Luna')
    expect(modelDisplayName('cursor', 'cursor-grok-4.6-medium')).toBe('Grok 4.6 Medium')
    expect(modelDisplayName('cursor', 'composer-2.5')).toBe('Composer 2.5')
  })

  it('does not touch a name that already reads as one', () => {
    // Providers give real display names, and this runs over those too. It
    // must be a no-op on them or it would slowly corrupt what they said.
    expect(modelDisplayName('codex', 'GPT-6 Astra')).toBe('GPT-6 Astra')
    expect(modelDisplayName('cursor', 'Grok 4.6')).toBe('Grok 4.6')
    expect(modelDisplayName('claude', 'Sonnet')).toBe('Sonnet')
  })

  it('drops a provider that repeats the runtime and keeps one that does not', () => {
    // OpenCode aggregates, so whose model it is stays -- that is the reason
    // `modelLabelFor` exists and this must not undo it.
    expect(modelDisplayName('opencode', 'opencode/ling-3.0-flash-fin-free')).toBe('Ling 3.0 Flash Fin Free')
    expect(modelDisplayName('opencode', 'anthropic/claude-sonnet-4')).toBe('Anthropic/Claude Sonnet 4')
  })

  it('invents nothing: every word comes from the id', () => {
    // An id nobody anticipated still reads as itself.
    expect(modelDisplayName('cursor', 'some-unheard-of-model-9')).toBe('Some Unheard Of Model 9')
    expect(modelDisplayName('claude', 'sonnet')).toBe('Sonnet')
  })

  it('leaves an id with nothing but the runtime in it alone', () => {
    expect(modelDisplayName('cursor', 'cursor')).toBe('Cursor')
  })

  it('keeps the second word where it is the program being named', () => {
    // Settings is telling you which program this is; the chip is not.
    expect(shortRuntimeName('opencode')).toBe('OpenCode')
    expect(shortRuntimeName('antigravity')).toBe('Antigravity')
  })
})
