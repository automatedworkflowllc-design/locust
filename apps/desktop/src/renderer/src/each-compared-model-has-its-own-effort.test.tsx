import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import type { ComparePick, ComparePicking } from './components/RoutePicker.js'
import type { PublicModel } from '../../shared/ipc.js'
import { startRoute } from './status.js'

/**
 * EACH COMPARED MODEL HAS ITS OWN EFFORT (0.490). Colin, 2026-09-30: "still no
 * effort control for compare". The composer's one effort chip was hidden in a
 * comparison ("no one effort applies to all") and nothing took its place, so
 * every column ran at its model's default and there was no way to compare
 * Opus at High against GPT at XHigh. Each column's model chip now carries its
 * own effort, joined to it.
 */
const model = (over: Partial<PublicModel> & Pick<PublicModel, 'runtime' | 'id'>): PublicModel =>
  ({ displayName: over.id, description: '', supportedEfforts: [], ...over }) as PublicModel

const MODELS: readonly PublicModel[] = [
  model({ runtime: 'claude', id: 'opus', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' }),
  model({ runtime: 'codex', id: 'gpt-6', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' }),
  model({ runtime: 'opencode', id: 'big-pickle-free' }),
  model({
    runtime: 'cursor',
    id: 'cursor-grok-4.7-high',
    displayName: 'Grok 4.7',
    supportedEfforts: ['low', 'high'],
    variants: { low: 'cursor-grok-4.7-low', high: 'cursor-grok-4.7-high' }
  })
]

function slots(picks: readonly ComparePick[]): string {
  const compare: ComparePicking = {
    on: true,
    picks,
    onMode: () => undefined,
    onToggle: () => undefined,
    onEffort: () => undefined,
    refusal: () => undefined
  }
  const props = {
    runtimes: [],
    limitedRuntimes: new Map(),
    discoveryPhase: 'ready',
    models: MODELS,
    resolvedModels: new Map(),
    route: { runtime: 'claude', model: 'opus' },
    mode: 'ask',
    onModeChange: () => undefined,
    onRouteChange: () => undefined,
    onSend: () => undefined,
    running: false,
    platform: 'win32',
    compare
  } as unknown as ComposerProps
  return renderToStaticMarkup(<Composer {...props} />)
}

const efforts = (html: string): string[] => [...html.matchAll(/aria-label="(Effort for model [^"]*)"/g)].map((m) => m[1]!)

describe('a comparison being set up', () => {
  it('gives each model its own effort, at the level chosen for it', () => {
    const html = slots([
      { runtime: 'claude', model: 'opus', label: 'Opus', effort: 'max' },
      { runtime: 'codex', model: 'gpt-6', label: 'GPT-6', effort: 'low' }
    ])
    expect(efforts(html)).toEqual(['Effort for model A: Max', 'Effort for model B: Low'])
  })

  it("shows a model's default when none was chosen, and the level a Cursor id already names", () => {
    const html = slots([
      { runtime: 'codex', model: 'gpt-6', label: 'GPT-6' },
      { runtime: 'cursor', model: 'cursor-grok-4.7-low', label: 'Grok 4.7' }
    ])
    expect(efforts(html)).toEqual(['Effort for model A: Medium', 'Effort for model B: Low'])
  })

  it('offers no effort for a model that lists no levels', () => {
    const html = slots([
      { runtime: 'claude', model: 'opus', label: 'Opus' },
      { runtime: 'opencode', model: 'big-pickle-free', label: 'Big Pickle' }
    ])
    expect(efforts(html)).toEqual(['Effort for model A: High'])
  })
})

describe('what each column is started with', () => {
  it('sends the effort as a flag, or as the Cursor id it names', () => {
    expect(startRoute(MODELS, 'claude', 'opus', 'max')).toEqual({ model: 'opus', effort: 'max' })
    expect(startRoute(MODELS, 'cursor', 'cursor-grok-4.7-high', 'low')).toEqual({ model: 'cursor-grok-4.7-low' })
  })
})
