import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A MEMORY SHOWS WHAT IT SAID BEFORE, AND THE WAY BACK.
 *
 * The store has kept one step back since 0.242 and the Memory screen never
 * showed it: a teammate could rewrite a memory and the person could not see
 * what it had said, or put it back (harness review, 2026-09-24).
 */
const noop = async (): Promise<undefined> => undefined
const base: PublicMemory = {
  memoryId: 'mem_1',
  text: 'Orb suite: 31/31 passing.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'Yurt' },
  createdAt: '2026-09-01T10:00:00.000Z',
  status: 'kept',
  enabled: true
}
const screen = (memories: readonly PublicMemory[]): string =>
  renderToStaticMarkup(
    <MemoryScreen
      memories={memories}
      workspaceId="ws_shop"
      workspaceName="shop"
      teammates={[]}
      mode="auto"
      onModeChange={() => undefined}
      onAdd={noop}
      onUpdate={noop}
      onRemove={noop}
      onClear={noop}
      onOpenMission={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
    />
  )

describe('a rewritten memory on the Memory screen', () => {
  it('shows what it said before, with Put it back, and when it changed', () => {
    const html = screen([{ ...base, previousText: 'Orb suite: 29/31, two flaky.', updatedAt: '2026-09-24T05:00:00.000Z', name: 'orb-suite-status' }])
    expect(html).toContain('lc-memory__was')
    expect(html).toContain('Was: Orb suite: 29/31, two flaky.')
    expect(html).toContain('>Put it back</button>')
    expect(html).toMatch(/changed [A-Z][a-z]{2} 24/)
  })

  it('shows nothing extra for a memory never changed', () => {
    const html = screen([base])
    expect(html).not.toContain('lc-memory__was')
    expect(html).not.toContain('changed ')
  })
})
