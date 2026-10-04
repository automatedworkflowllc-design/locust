import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicForgottenMemory, PublicMemory } from '../../shared/ipc.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * RECENTLY FORGOTTEN, ON THE MEMORY SCREEN (A1.8).
 *
 * Every kept memory that is forgotten is held 7 days; the screen lists them
 * with who forgot them and a Restore, and Forget everything no longer says
 * "This cannot be undone" -- it can, for 7 days.
 */
const noop = async (): Promise<undefined> => undefined
const memory: PublicMemory = {
  memoryId: 'mem_1',
  text: 'The API is on port 3000.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'you' },
  createdAt: '2026-09-01T10:00:00.000Z',
  status: 'kept',
  enabled: true
}
const forgotten: PublicForgottenMemory = { memory, forgottenAt: '2026-09-24T05:00:00.000Z', forgottenBy: { teammateId: 'tm_booty', name: 'Booty' } }

const screen = (props: { readonly forgotten?: readonly PublicForgottenMemory[]; readonly memories?: readonly PublicMemory[] }): string =>
  renderToStaticMarkup(
    <MemoryScreen
      memories={props.memories ?? []}
      workspaceId="ws_shop"
      workspaceName="shop"
      teammates={[]}
      mode="auto"
      onModeChange={() => undefined}
      onAdd={noop}
      onUpdate={noop}
      onRemove={noop}
      onClear={noop}
      forgotten={props.forgotten ?? []}
      onRestore={noop}
      onOpenMission={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
    />
  )

describe('Recently forgotten', () => {
  it('lists what was forgotten, by whom and when, with Restore', () => {
    const html = screen({ forgotten: [forgotten] })
    expect(html).toContain('Recently forgotten')
    expect(html).toContain('Kept for 7 days, then gone for good.')
    expect(html).toContain('lc-memory is-forgotten')
    expect(html).toContain('The API is on port 3000.')
    expect(html).toContain('forgotten by Booty')
    expect(html).toMatch(/Sep 24/)
    expect(html).toContain('>Restore</button>')
  })

  it('is not drawn when nothing was forgotten', () => {
    expect(screen({})).not.toContain('Recently forgotten')
  })
})
