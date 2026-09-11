import { describe, expect, it } from 'vitest'

import type { CodexMissionUpdate, PublicTeammate, WorkspaceSettings } from '../shared/ipc.js'
import { createMemoryReader } from './memory-reader.js'
import type { MemoryReaderOptions } from './memory-reader.js'

const SETTINGS: WorkspaceSettings = { swarm: false, relay: true, relayHopCap: 6, interrupt: false, memoryMode: 'auto', autoMode: false, askConnectors: false, layout: 'auto' }

const reply = (text: string) => [
  { type: 'message.delta', payload: { itemId: 'm1', operation: 'append', text, final: true } }
]

function harness(input: {
  readonly phase?: string
  readonly reply: string
  readonly mode?: WorkspaceSettings['memoryMode']
  readonly owner?: string
  readonly full?: boolean
}) {
  const added: Parameters<MemoryReaderOptions['memories']['add']>[0][] = []
  const forgotten: string[] = []
  const updates: CodexMissionUpdate[] = []
  const options: MemoryReaderOptions = {
    memories: {
      add: async (memory) => {
        if (input.full === true) throw new Error('full')
        added.push(memory)
        const duplicate = added.filter((entry) => entry.text === memory.text).length > 1
        return {
          memory: { memoryId: `mem_${String(added.length)}`, text: String(memory.text), scope: memory.scope as 'workspace', workspaceId: memory.workspaceId, workspaceName: memory.workspaceName, by: memory.by, createdAt: 'now', status: memory.status, enabled: true },
          created: !duplicate
        }
      },
      forget: async (text) => {
        forgotten.push(text)
        return text.includes('port') ? 1 : 0
      }
    },
    ledger: {
      getMission: async () =>
        ({ metadata: { missionId: 'mission_1', runId: 'run_1', workspaceId: 'ws_shop' }, phase: input.phase ?? 'completed', events: reply(input.reply) }) as never
    },
    teammates: {
      list: async () => [{ teammateId: 'tm_wren', name: 'Wren' } as PublicTeammate],
      missionOwners: async (): Promise<Readonly<Record<string, string>>> => (input.owner === undefined ? {} : { mission_1: input.owner }),
      readSettings: async () => ({ ...SETTINGS, memoryMode: input.mode ?? 'auto' })
    },
    workspaceName: 'shop',
    notify: (update) => {
      updates.push(update)
    }
  }
  return { added, forgotten, updates, reader: createMemoryReader(options) }
}

const BLOCK = 'Done.\n<locust-memory>\nremember :: Tests run with pnpm test.\nremember everywhere :: Colin wants diffs.\nforget :: The API is on port 3000\nforget :: nothing like this\n</locust-memory>'

describe('reading a reply for memory', () => {
  it("keeps what a completed run said to remember, attributed to the teammate, folder and conversation, and says so twice", async () => {
    const h = harness({ reply: BLOCK, owner: 'tm_wren' })
    await h.reader.onRunEnded({ missionId: 'mission_1' })
    expect(h.added.map((m) => [m.text, m.scope, m.status, m.workspaceId, m.by.name, m.missionId])).toEqual([
      ['Tests run with pnpm test.', 'workspace', 'kept', 'ws_shop', 'Wren', 'mission_1'],
      ['Colin wants diffs.', 'global', 'kept', 'ws_shop', 'Wren', 'mission_1']
    ])
    expect(h.forgotten).toEqual(['The API is on port 3000', 'nothing like this'])
    const notice = h.updates.find((u) => u.kind === 'relay-notice')
    expect(notice).toMatchObject({ kind: 'relay-notice', runId: 'run_1', missionId: 'mission_1' })
    expect((notice as { message: string }).message).toBe('Wren remembered "Tests run with pnpm test."; "Colin wants diffs."; forgot "The API is on port 3000".')
    expect(h.updates.find((u) => u.kind === 'memory-changed')).toEqual({
      kind: 'memory-changed',
      by: 'Wren',
      kept: ['Tests run with pnpm test.', 'Colin wants diffs.'],
      proposed: [],
      forgotten: ['The API is on port 3000']
    })
  })

  it('in ask mode a memory is proposed, not kept, and the notice says where to answer', async () => {
    const h = harness({ reply: BLOCK, owner: 'tm_wren', mode: 'ask' })
    await h.reader.onRunEnded({ missionId: 'mission_1' })
    expect(h.added.every((m) => m.status === 'proposed')).toBe(true)
    const notice = h.updates.find((u) => u.kind === 'relay-notice') as { message: string }
    expect(notice.message).toContain('wants to remember')
    expect(notice.message).toContain('Memory screen')
  })

  it('off means nothing is read; a run that did not complete, or a reply with no block, writes nothing', async () => {
    for (const h of [
      harness({ reply: BLOCK, owner: 'tm_wren', mode: 'off' }),
      harness({ reply: BLOCK, owner: 'tm_wren', phase: 'failed' }),
      harness({ reply: 'Done, nothing to keep.', owner: 'tm_wren' })
    ]) {
      await h.reader.onRunEnded({ missionId: 'mission_1' })
      expect(h.added).toEqual([])
      expect(h.updates).toEqual([])
    }
  })

  it('a conversation nobody owns is attributed as one; a store that refuses is not a crash and not a notice', async () => {
    const nobody = harness({ reply: BLOCK })
    await nobody.reader.onRunEnded({ missionId: 'mission_1' })
    expect(nobody.added[0]?.by).toEqual({ name: 'a conversation' })
    const full = harness({ reply: BLOCK, owner: 'tm_wren', full: true })
    await full.reader.onRunEnded({ missionId: 'mission_1' })
    // forget still ran and found one, so that alone is reported
    expect(full.updates.find((u) => u.kind === 'memory-changed')).toMatchObject({ kept: [], proposed: [], forgotten: ['The API is on port 3000'] })
  })
})
