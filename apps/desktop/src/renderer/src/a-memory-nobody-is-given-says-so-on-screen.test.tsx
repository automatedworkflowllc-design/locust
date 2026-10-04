import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/** A memory no teammate has been given in a month says so on the Memory screen (A1.4). */
const noop = async (): Promise<undefined> => undefined
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const memory: PublicMemory = {
  memoryId: 'mem_old',
  text: 'An old note.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'you' },
  createdAt: ago(90),
  status: 'kept',
  enabled: true
}
const screen = (memories: readonly PublicMemory[], briefTrackingSince: string | undefined): string =>
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
      {...(briefTrackingSince === undefined ? {} : { briefTrackingSince })}
      onOpenMission={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
    />
  )

describe('a memory nobody has been given in a month', () => {
  it('says how long', () => {
    expect(screen([memory], ago(40))).toContain('No teammate has been given this in 40 days.')
  })

  it('says nothing for one given lately, or before a month of counting', () => {
    expect(screen([{ ...memory, lastBriefedAt: ago(3) }], ago(40))).not.toContain('No teammate has been given this')
    expect(screen([memory], ago(10))).not.toContain('No teammate has been given this')
  })
})
