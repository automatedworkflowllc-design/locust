import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RoutePicker } from './components/RoutePicker.js'
import type { PublicModel, PublicRuntimeStatus } from '../../shared/ipc.js'

/**
 * A PICKER ROW IS NAMED, NOT AN ID (seen on the packaged 0.482). OpenCode's
 * catalogue names a model by its id without the provider --
 * `ling-3.0-flash-fin-free` for `opencode/ling-3.0-flash-fin-free` -- and the
 * picker drew that raw while the chip and the team card said "Ling 3.0 Flash
 * Fin". Only the check for "the name IS the id" missed that shape.
 */
const opencode: PublicRuntimeStatus = {
  id: 'opencode',
  displayName: 'OpenCode',
  installed: true,
  version: '1.18.27',
  auth: 'authenticated',
  ready: true,
  status: 'ready'
}

const draw = (models: readonly PublicModel[]): string =>
  renderToStaticMarkup(
    <RoutePicker
      runtimes={[opencode]}
      limitedRuntimes={new Map()}
      models={models}
      resolvedModels={new Map()}
      recentRoutes={[]}
      active={{ runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free' }}
      onSelect={() => undefined}
      onClose={() => undefined}
    />
  )

const labels = (html: string): readonly string[] => [...html.matchAll(/class="lc-picker__label">([^<]*)</g)].map((found) => found[1]!)

describe('an OpenCode model in the picker', () => {
  it('named by its id without the provider is spelled out', () => {
    const html = draw([{ id: 'opencode/ling-3.0-flash-fin-free', runtime: 'opencode', displayName: 'ling-3.0-flash-fin-free', description: '', supportedEfforts: [] }])
    expect(labels(html)).not.toContain('ling-3.0-flash-fin-free')
    expect(labels(html).some((label) => /^Ling 3\.0 Flash Fin/.test(label))).toBe(true)
  })

  it('with a name of its own keeps that name exactly', () => {
    const html = draw([{ id: 'opencode/big-pickle', runtime: 'opencode', displayName: 'Big Pickle', description: '', supportedEfforts: [] }])
    expect(labels(html)).toContain('Big Pickle')
  })
})
