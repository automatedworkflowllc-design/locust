import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { MemoryScreen, keepEvery } from './components/MemoryScreen.js'

/**
 * A TIDY PASS IS ANSWERED IN ONE PRESS, IF THE PERSON AGREES (0.372).
 *
 * The 62-memory tidy drive left ten suggestions waiting, each with its own
 * Keep. Everything kept can be put back, so "Keep all" risks nothing a single
 * Keep does not -- and a suggestion shows the mark the conversation's memory
 * card uses, not a kept memory's on/off switch, drawn on and disabled.
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
const c = kept('mem_c', 'The API is on port 3000.')
const merge: PublicMemory = { ...a, memoryId: 'mem_m', text: 'Deploys go out every Thursday.', status: 'proposed', merges: ['mem_a', 'mem_b'], by: { name: 'Wren' }, missionId: 'mission_tidy', basis: '0123456789abcdef' }
const retire: PublicMemory = { ...c, memoryId: 'mem_r', status: 'proposed', forgets: 'mem_c', reason: 'the API moved to 3001', by: { name: 'Wren' }, missionId: 'mission_tidy', basis: '0123456789abcdef' }

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

describe('Keep all', () => {
  it('is offered once two or more are waiting, beside why it is safe', () => {
    const two = screen([a, b, c, merge, retire])
    expect(two).toMatch(/>Keep all 2<\/button>/)
    expect(two).toContain('Anything you keep can be put back.')
    expect(screen([a, b, c, merge])).not.toContain('Keep all')
  })

  it('keeps each in turn, in order, and says every refusal once', async () => {
    const asked: string[] = []
    const stale = 'What this suggestion would change has changed since it was made, so it was dropped. Everything is as it was.'
    const said = await keepEvery(['mem_m', 'mem_r', 'mem_x', 'mem_y'], async (memoryId) => {
      asked.push(memoryId)
      return memoryId === 'mem_x' || memoryId === 'mem_y' ? stale : undefined
    })
    expect(asked).toEqual(['mem_m', 'mem_r', 'mem_x', 'mem_y'])
    expect(said).toBe(stale)
    expect(await keepEvery(['mem_m'], noop)).toBeUndefined()
  })

  it('waits for each before the next: a later one is judged against what the earlier one did', async () => {
    const order: string[] = []
    await keepEvery(['first', 'second'], async (memoryId) => {
      order.push(`start ${memoryId}`)
      await new Promise((resolve) => setTimeout(resolve, memoryId === 'first' ? 20 : 0))
      order.push(`end ${memoryId}`)
      return undefined
    })
    expect(order).toEqual(['start first', 'end first', 'start second', 'end second'])
  })
})

describe('a suggestion’s row', () => {
  it('has the suggestion mark, not a switch; a kept memory keeps its switch', () => {
    const html = screen([a, b, c, merge, retire])
    expect([...html.matchAll(/lc-memory__suggested/g)]).toHaveLength(2)
    expect([...html.matchAll(/role="switch"/g)]).toHaveLength(3)
  })
})
