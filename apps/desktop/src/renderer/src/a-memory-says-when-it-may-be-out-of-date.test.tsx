import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A MEMORY SAYS WHEN IT MAY BE OUT OF DATE (A1.3), on the Memory screen too:
 * a file it names changed after it was written.
 */
const noop = async (): Promise<undefined> => undefined
const memory: PublicMemory = {
  memoryId: 'mem_r',
  text: 'Retries live in src/net.ts.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'you' },
  createdAt: '2026-09-20T12:00:00.000Z',
  status: 'kept',
  enabled: true
}
const screen = (changedSince: Readonly<Record<string, readonly string[]>>): string =>
  renderToStaticMarkup(
    <MemoryScreen
      memories={[memory]}
      workspaceId="ws_shop"
      workspaceName="shop"
      teammates={[]}
      mode="auto"
      onModeChange={() => undefined}
      onAdd={noop}
      onUpdate={noop}
      onRemove={noop}
      onClear={noop}
      changedSince={changedSince}
      onOpenMission={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
    />
  )

describe('a memory whose file changed', () => {
  it('says which file, under the memory', () => {
    expect(screen({ mem_r: ['src/net.ts'] })).toContain('May be out of date: src/net.ts changed since.')
  })

  it('says nothing when nothing it names changed', () => {
    expect(screen({})).not.toContain('May be out of date')
  })
})
