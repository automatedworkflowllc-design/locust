import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicMemory } from '../../shared/ipc.js'
import { memoriesOfConversation } from './conversationMemories.js'
import { memoryCardSummary } from './components/MemoryCard.js'
import { MemoryScreen } from './components/MemoryScreen.js'

/**
 * A REWRITE SHOWS ITS WRITER (A1.6, reported #21).
 *
 * After "Keep the change" the 0.315 drive's Memory screen read "Deploys go
 * out on Thursdays ... you" -- Booty's words, credited to the person who had
 * written "Fridays". And the memory card named the FIRST line's writer for
 * every line on it.
 */
const noop = async (): Promise<undefined> => undefined
const rewritten: PublicMemory = {
  memoryId: 'mem_1',
  text: 'Deploys go out on Thursdays.',
  previousText: 'Deploys go out on Fridays.',
  scope: 'workspace',
  workspaceId: 'ws_shop',
  workspaceName: 'shop',
  by: { name: 'you' },
  updatedBy: { teammateId: 'tm_booty', name: 'Booty' },
  updatedAt: '2026-09-24T05:00:00.000Z',
  missionId: 'mission_2',
  createdAt: '2026-09-01T10:00:00.000Z',
  status: 'kept',
  enabled: true
}

describe('who wrote it, on the Memory screen', () => {
  it('names the writer of the words shown, not who first kept it', () => {
    const html = renderToStaticMarkup(
      <MemoryScreen
        memories={[rewritten]}
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
    expect(html).toContain('<span>Booty</span>')
    expect(html).not.toContain('<span>you</span>')
  })
})

describe('who wrote it, on the memory card', () => {
  it('credits the rewrite to its writer', () => {
    const lines = memoriesOfConversation([rewritten], new Set(['mission_2']))
    expect(lines.map((line) => line.by)).toEqual(['Booty'])
    expect(memoryCardSummary(lines)).toBe('Booty updated 1 thing it already knew')
  })

  it('names every writer when the lines are more than one person’s', () => {
    const wren: PublicMemory = { ...rewritten, memoryId: 'mem_2', text: 'Tests run with pnpm test.', by: { name: 'Wren' }, updatedBy: undefined, previousText: undefined }
    const summary = memoryCardSummary(memoriesOfConversation([wren, rewritten], new Set(['mission_2'])))
    expect(summary).toBe('Wren and Booty remembered 1 thing and updated 1 thing it already knew')
  })
})
