import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { memoryChangedNotice, noticeWaits } from './conversationMemories.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A TIDY PASS, ANSWERED, LEAVES NO BANNER BEHIND (0.372).
 *
 * drive-memory-tidy on 0.371: "Wren suggested 2 changes to memory, waiting
 * below." stayed at the top of the Memory screen after both were answered,
 * pointing at a section that was gone. And the suggestions sat under "How
 * memory is kept", so a person sent to answer them arrived at the
 * explanation first.
 */
const noop = async (): Promise<undefined> => undefined
const kept = (memoryId: string, text: string): PublicMemory => ({
  memoryId,
  text,
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'you' },
  createdAt: '2026-09-01T10:00:00.000Z',
  status: 'kept',
  enabled: true
})
const a = kept('mem_a', 'Deploys go out on Thursdays.')
const b = kept('mem_b', 'We deploy every Thursday.')
const merge: PublicMemory = { ...a, memoryId: 'mem_m', text: 'Deploys go out every Thursday.', status: 'proposed', merges: ['mem_a', 'mem_b'], by: { name: 'Wren' }, missionId: 'mission_tidy', basis: '0123456789abcdef' }
const TIDIED = { by: 'Wren', kept: [], proposed: [], forgotten: [], proposedTidy: 2 }
const NOTICE = memoryChangedNotice(TIDIED)

const screen = (memories: readonly PublicMemory[], waits: boolean): string =>
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
      notice={NOTICE}
      noticeWaits={waits}
      onDismissNotice={() => undefined}
    />
  )

describe('the notice a tidy pass leaves', () => {
  it('points at what is waiting, and says so of itself', () => {
    expect(NOTICE).toBe('Wren suggested 2 changes to memory, waiting below.')
    expect(noticeWaits(TIDIED)).toBe(true)
    expect(noticeWaits({ by: 'Wren', kept: [], proposed: ['x'], forgotten: [] })).toBe(true)
    expect(noticeWaits({ by: 'Wren', kept: [], proposed: [], forgotten: [], proposedForgets: ['x'] })).toBe(true)
    expect(noticeWaits({ by: 'Wren', kept: ['x'], proposed: [], forgotten: ['y'] })).toBe(false)
  })

  it('is shown while something is still waiting', () => {
    expect(screen([a, b, merge], true)).toContain('Wren suggested 2 changes to memory, waiting below.')
  })

  it('is gone once nothing is -- but a notice about what already happened stays until dismissed', () => {
    expect(screen([a, b], true)).not.toContain('waiting below')
    expect(screen([a, b], false)).toContain('Wren suggested 2 changes to memory')
  })
})

describe('the Memory screen', () => {
  it('puts what is waiting for an answer above how memory works', () => {
    const html = screen([a, b, merge], true)
    const waiting = html.indexOf('Waiting for you')
    expect(waiting).toBeGreaterThan(-1)
    expect(waiting).toBeLessThan(html.indexOf('How memory is kept'))
  })
})
