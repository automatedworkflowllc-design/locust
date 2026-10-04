import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { memoriesOfConversation, memoryChangedNotice } from './conversationMemories.js'
import { memoryCardSummary } from './components/MemoryCard.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A PROPOSED CHANGE SAYS WHAT IT CHANGES (0.315).
 *
 * "Ask me first" now covers a teammate rewriting or forgetting a memory the
 * person kept: each waits as a proposal beside it. Drawn as a plain proposal
 * it would read "Keep / Forget" over the NEW words -- and for a forget, over
 * the very words the teammate wants gone, where "Keep" means the opposite of
 * keeping them. So each says what it asks, and its buttons say what they do.
 */
const noop = async (): Promise<undefined> => undefined
const kept: PublicMemory = {
  memoryId: 'mem_kept',
  text: 'Deploys go out on Fridays.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'Yurt' },
  createdAt: '2026-09-01T10:00:00.000Z',
  status: 'kept',
  enabled: true,
  name: 'deploy-day'
}
const rewrite: PublicMemory = { ...kept, memoryId: 'mem_change', text: 'Deploys go out on Thursdays.', status: 'proposed', replaces: 'mem_kept', missionId: 'mission_2' }
const forget: PublicMemory = { ...kept, memoryId: 'mem_forget', status: 'proposed', forgets: 'mem_kept', missionId: 'mission_2' }
const fresh: PublicMemory = { ...kept, memoryId: 'mem_new', text: 'Tests run with pnpm test.', status: 'proposed', missionId: 'mission_2' }

const screen = (memories: readonly PublicMemory[]): string =>
  renderToStaticMarkup(
    <MemoryScreen
      memories={memories}
      workspaceId="ws_shop"
      workspaceName="shop"
      teammates={[]}
      mode="ask"
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

describe('a proposed change on the Memory screen', () => {
  it('a rewrite shows the new words, the ones kept now, and Keep the change / Keep the old one', () => {
    const html = screen([kept, rewrite])
    expect(html).toContain('Wants to change this to: </span>Deploys go out on Thursdays.')
    expect(html).toContain('Now: Deploys go out on Fridays.')
    expect(html).toContain('>Keep the change</button>')
    expect(html).toContain('>Keep the old one</button>')
  })

  it('a forget says so, and its buttons are Forget it / Keep it', () => {
    const html = screen([kept, forget])
    expect(html).toContain('Wants to forget this: </span>Deploys go out on Fridays.')
    expect(html).toContain('>Forget it</button>')
    expect(html).toContain('>Keep it</button>')
  })

  it('a new memory is asked about as it always was', () => {
    const html = screen([fresh])
    expect(html).toContain('>Keep</button>')
    expect(html).toContain('>Forget</button>')
    expect(html).not.toContain('lc-memory__change')
  })
})

describe('a proposed change on the memory card', () => {
  const lines = memoriesOfConversation([kept, rewrite, forget, fresh], new Set(['mission_2']))

  it('is named for what it asks, not as something to remember', () => {
    expect(lines.map((line) => line.change)).toEqual(['rewrite', 'forget', undefined])
    expect(memoryCardSummary(lines)).toBe(
      'Yurt wants to remember 1 thing and wants to change 1 thing it already knew and wants to forget 1 thing — answer it on the Memory screen'
    )
  })

  it('a card of new proposals only reads as it always did', () => {
    expect(memoryCardSummary(memoriesOfConversation([fresh], new Set(['mission_2'])))).toBe(
      'Yurt wants to remember 1 thing — keep or forget it on the Memory screen'
    )
  })
})

describe('the notice on the Memory screen', () => {
  it('names each change for what it is, in sentences -- no ".". after a quoted memory', () => {
    expect(
      memoryChangedNotice({
        by: 'Booty',
        kept: [],
        proposed: [],
        forgotten: [],
        proposedChanges: ['Deploys go out on Thursdays.'],
        proposedForgets: ['The API is on port 3000.']
      })
    ).toBe('Booty wants to change a memory to "Deploys go out on Thursdays." Booty wants to forget "The API is on port 3000."')
  })

  it('ends a clause whose memory has no full stop of its own', () => {
    expect(memoryChangedNotice({ by: 'Wren', kept: ['Build with pnpm build'], proposed: [], forgotten: [] })).toBe('Wren remembered "Build with pnpm build".')
  })

  it('is nothing at all when nothing happened', () => {
    expect(memoryChangedNotice({ by: 'Wren', kept: [], proposed: [], forgotten: [] })).toBeUndefined()
  })
})
