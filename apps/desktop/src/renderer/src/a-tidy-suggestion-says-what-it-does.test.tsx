import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { TIDY_NUDGE_AT } from '../../shared/memory-tidy.js'
import { memoriesOfConversation, memoryChangedNotice } from './conversationMemories.js'
import { memoryCardSummary } from './components/MemoryCard.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A TIDY SUGGESTION SAYS WHAT IT DOES (A1.2).
 *
 * A merge shows the one sentence and every memory it would replace, with
 * "Merge them" / "Keep them apart"; a retirement says why; the screen offers
 * a tidy pass once there is something to tidy, and says so outright past
 * TIDY_NUDGE_AT memories.
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
const retire: PublicMemory = { ...c, memoryId: 'mem_r', status: 'proposed', forgets: 'mem_c', reason: 'the API moved to 3001 (mem_a)', by: { name: 'Wren' }, missionId: 'mission_tidy', basis: '0123456789abcdef' }

const screen = (memories: readonly PublicMemory[], extra: { readonly onTidy?: (anchor: HTMLElement) => void; readonly mode?: 'auto' | 'ask' | 'off' } = {}): string =>
  renderToStaticMarkup(
    <MemoryScreen
      memories={memories}
      workspaceId="ws_shop"
      workspaceName="shop"
      teammates={[]}
      mode={extra.mode ?? 'auto'}
      onModeChange={() => undefined}
      onAdd={noop}
      onUpdate={noop}
      onRemove={noop}
      onClear={noop}
      {...(extra.onTidy === undefined ? {} : { onTidy: extra.onTidy })}
      onOpenMission={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
    />
  )

describe('a tidy suggestion on the Memory screen', () => {
  it('a merge: the one sentence, every memory it replaces, Merge them / Keep them apart', () => {
    const html = screen([a, b, merge])
    expect(html).toContain('Wants to merge these into one: </span>Deploys go out every Thursday.')
    expect(html).toContain('Now: Deploys go out on Thursdays.')
    expect(html).toContain('Now: We deploy every Thursday.')
    expect(html).toContain('>Merge them</button>')
    expect(html).toContain('>Keep them apart</button>')
  })

  it('a retirement says why -- in words, not the ids the model cited', () => {
    const html = screen([c, retire])
    expect(html).toContain('Wants to forget this: </span>The API is on port 3000.')
    expect(html).toContain('Why: the API moved to 3001<')
    expect(html).not.toContain('mem_a')
  })
})

describe('offering a tidy pass', () => {
  it('once there is something to tidy, memory is on, and a teammate can be asked', () => {
    const offered = screen([a, b], { onTidy: () => undefined })
    expect(offered).toContain('Tidy up…')
    expect(offered).toContain('suggests merges and retirements; nothing changes until you keep it')
    expect(screen([a], { onTidy: () => undefined })).not.toContain('Tidy up…')
    expect(screen([a, b], { onTidy: () => undefined, mode: 'off' })).not.toContain('Tidy up…')
    expect(screen([a, b])).not.toContain('Tidy up…')
  })

  it(`says so outright past ${String(TIDY_NUDGE_AT)} memories`, () => {
    const many = Array.from({ length: TIDY_NUDGE_AT + 1 }, (_, index) => kept(`mem_${String(index)}`, `Note number ${String(index)}.`))
    expect(screen(many, { onTidy: () => undefined })).toContain(`${String(TIDY_NUDGE_AT + 1)} memories here.`)
    expect(screen(many.slice(0, TIDY_NUDGE_AT), { onTidy: () => undefined })).not.toContain('memories here.')
  })
})

describe('a tidy pass in the conversation, and on the screen notice', () => {
  it('the card names the merge and the retirement for what they ask', () => {
    const lines = memoriesOfConversation([a, b, c, merge, retire], new Set(['mission_tidy']))
    expect(lines.map((line) => line.change)).toEqual(['merge', 'forget'])
    expect(memoryCardSummary(lines)).toBe('Wren wants to forget 1 thing and wants to merge 1 set of memories — answer it on the Memory screen')
  })

  it('the notice counts the suggestions and says which could not be made', () => {
    expect(
      memoryChangedNotice({ by: 'Wren', kept: [], proposed: [], forgotten: [], proposedTidy: 2, tidyRefused: ['A suggestion to forget a memory named one this folder does not keep.'] })
    ).toBe('Wren suggested 2 changes to memory, waiting below. 1 could not be made: A suggestion to forget a memory named one this folder does not keep.')
  })
})
