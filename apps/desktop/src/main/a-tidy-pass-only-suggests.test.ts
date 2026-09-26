import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { CodexMissionUpdate, PublicTeammate, WorkspaceSettings } from '../shared/ipc.js'
import { memoryFileText } from './memory-file.js'
import { createMemoryReader } from './memory-reader.js'
import { SUGGESTION_OUT_OF_DATE, createMemoryStore } from './memory-store.js'

/*
 * A TIDY PASS ONLY SUGGESTS (A1.2).
 *
 * A teammate reads the folder's memories and suggests merges, retirements
 * and rewrites. Each becomes a proposal on the Memory screen; the memories
 * stay as they are, and briefed, until the person keeps one. A suggestion
 * about words that have since changed is refused when kept -- the hash gate.
 */

const NOW = '2026-09-24T12:00:00.000Z'
let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-tidy-'))
  let ids = 0
  return createMemoryStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => `id${String(++ids)}` })
}

const YOU = { name: 'you' }
const WREN = { teammateId: 'tm_wren', name: 'Wren' }
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }

async function seeded() {
  const memories = await store()
  const add = async (text: string, extra: Record<string, unknown> = {}) =>
    (await memories.add({ text, scope: 'workspace', ...SHOP, by: YOU, status: 'kept', ...extra })).memory
  const a = await add('Deploys go out on Thursdays.')
  const b = await add('We deploy every Thursday.')
  const c = await add('The API is on port 3000.')
  const d = await add('Tests run with npm test.')
  return { memories, a, b, c, d }
}

describe('suggestions become proposals, and nothing kept changes', () => {
  it('a merge, a retirement and a rewrite wait beside the memories, which stay briefed', async () => {
    const { memories, a, b, c, d } = await seeded()
    const result = await memories.proposeTidy({
      workspaceId: 'ws_shop',
      by: WREN,
      missionId: 'mission_tidy',
      suggestions: [
        { kind: 'merge', ids: [a.memoryId, b.memoryId], text: 'Deploys go out every Thursday.' },
        { kind: 'retire', id: c.memoryId, reason: 'the API moved to 3001' },
        { kind: 'rewrite', id: d.memoryId, text: 'Tests run with pnpm test.' }
      ]
    })
    expect(result).toEqual({ proposed: 3, refused: [] })
    expect((await memories.briefed('ws_shop')).map((memory) => memory.text)).toEqual([a.text, b.text, c.text, d.text])
    const waiting = (await memories.list()).filter((memory) => memory.status === 'proposed')
    expect(waiting.map((memory) => [memory.merges ?? memory.forgets ?? memory.replaces, memory.text, memory.reason, memory.by.name, memory.missionId])).toEqual([
      [[a.memoryId, b.memoryId], 'Deploys go out every Thursday.', undefined, 'Wren', 'mission_tidy'],
      [c.memoryId, c.text, 'the API moved to 3001', 'Wren', 'mission_tidy'],
      [d.memoryId, 'Tests run with pnpm test.', undefined, 'Wren', 'mission_tidy']
    ])
    expect(waiting.every((memory) => memory.basis !== undefined)).toBe(true)
  })

  it('refuses what it cannot stand behind, and says why', async () => {
    const { memories, a } = await seeded()
    const elsewhere = (await memories.add({ text: 'Another project.', scope: 'workspace', workspaceId: 'ws_other', workspaceName: 'other', by: YOU, status: 'kept' })).memory
    const everywhere = (await memories.add({ text: 'Colin reads on his phone.', scope: 'global', ...SHOP, by: YOU, status: 'kept' })).memory
    const result = await memories.proposeTidy({
      workspaceId: 'ws_shop',
      by: WREN,
      suggestions: [
        { kind: 'retire', id: 'mem_nothing', reason: 'x' },
        { kind: 'rewrite', id: elsewhere.memoryId, text: 'Not this folder.' },
        { kind: 'merge', ids: [a.memoryId, everywhere.memoryId], text: 'Two places.' }
      ]
    })
    expect(result.proposed).toBe(0)
    expect(result.refused).toEqual([
      'A suggestion to forget a memory named one this folder does not keep.',
      'A suggestion to change a memory named one this folder does not keep.',
      'A suggested merge joined memories kept in different places -- this folder and everywhere.'
    ])
  })

  it('asked twice, still one of each; a newer rewrite updates the one waiting', async () => {
    const { memories, a, b, c, d } = await seeded()
    const once = [
      { kind: 'merge' as const, ids: [a.memoryId, b.memoryId], text: 'Deploys go out every Thursday.' },
      { kind: 'retire' as const, id: c.memoryId, reason: 'moved' },
      { kind: 'rewrite' as const, id: d.memoryId, text: 'Tests run with pnpm test.' }
    ]
    await memories.proposeTidy({ workspaceId: 'ws_shop', by: WREN, suggestions: once })
    await memories.proposeTidy({ workspaceId: 'ws_shop', by: WREN, suggestions: [...once.slice(0, 2), { kind: 'rewrite', id: d.memoryId, text: 'Tests run with pnpm vitest.' }] })
    const waiting = (await memories.list()).filter((memory) => memory.status === 'proposed')
    expect(waiting).toHaveLength(3)
    expect(waiting.find((memory) => memory.replaces === d.memoryId)?.text).toBe('Tests run with pnpm vitest.')
  })
})

describe('the person answers', () => {
  it('Merge them: the first takes the words, the rest go to Recently forgotten by who suggested it', async () => {
    const { memories, a, b } = await seeded()
    await memories.proposeTidy({ workspaceId: 'ws_shop', by: WREN, missionId: 'mission_tidy', suggestions: [{ kind: 'merge', ids: [a.memoryId, b.memoryId], text: 'Deploys go out every Thursday.' }] })
    const proposal = (await memories.list()).find((memory) => memory.merges !== undefined)!
    const merged = await memories.update({ memoryId: proposal.memoryId, keep: true })
    expect(merged).toMatchObject({ memoryId: a.memoryId, text: 'Deploys go out every Thursday.', previousText: a.text, updatedBy: WREN, missionId: 'mission_tidy' })
    const held = await memories.snapshot()
    expect(held.memories.map((memory) => memory.memoryId)).not.toContain(b.memoryId)
    expect(held.memories.some((memory) => memory.status === 'proposed')).toBe(false)
    expect(held.forgotten.map((entry) => [entry.memory.memoryId, entry.forgottenBy.name])).toEqual([[b.memoryId, 'Wren']])
  })

  it('Keep them apart: only the suggestion goes', async () => {
    const { memories, a, b } = await seeded()
    await memories.proposeTidy({ workspaceId: 'ws_shop', by: WREN, suggestions: [{ kind: 'merge', ids: [a.memoryId, b.memoryId], text: 'One.' }] })
    const proposal = (await memories.list()).find((memory) => memory.merges !== undefined)!
    await memories.remove(proposal.memoryId)
    expect((await memories.list()).map((memory) => memory.text)).toEqual([a.text, b.text, 'The API is on port 3000.', 'Tests run with npm test.'])
  })

  it('THE HASH GATE: a suggestion about words that changed is refused when kept, and dropped', async () => {
    const { memories, a, b } = await seeded()
    await memories.proposeTidy({ workspaceId: 'ws_shop', by: WREN, suggestions: [{ kind: 'merge', ids: [a.memoryId, b.memoryId], text: 'Deploys go out every Thursday.' }] })
    const proposal = (await memories.list()).find((memory) => memory.merges !== undefined)!
    // The person corrects one of them after the suggestion was made.
    await memories.update({ memoryId: b.memoryId, text: 'We deploy every Wednesday now.' })
    await expect(memories.update({ memoryId: proposal.memoryId, keep: true })).rejects.toThrow(SUGGESTION_OUT_OF_DATE)
    const after = await memories.list()
    expect(after.some((memory) => memory.memoryId === proposal.memoryId)).toBe(false)
    expect(after.find((memory) => memory.memoryId === b.memoryId)?.text).toBe('We deploy every Wednesday now.')
    expect(after.find((memory) => memory.memoryId === a.memoryId)?.text).toBe(a.text)
  })

  it('the gate covers an "Ask me first" rewrite too: kept after the person edited it, refused', async () => {
    const memories = await store()
    const { memory: kept } = await memories.add({ text: 'Deploys go out on Fridays.', scope: 'workspace', ...SHOP, by: YOU, status: 'kept', name: 'deploy-day' })
    const { memory: proposal } = await memories.add({ text: 'Deploys go out on Thursdays.', scope: 'workspace', ...SHOP, by: WREN, status: 'proposed', name: 'deploy-day' })
    await memories.update({ memoryId: kept.memoryId, text: 'Deploys go out on Mondays.' })
    await expect(memories.update({ memoryId: proposal.memoryId, keep: true })).rejects.toThrow(SUGGESTION_OUT_OF_DATE)
    expect((await memories.list()).map((memory) => memory.text)).toEqual(['Deploys go out on Mondays.'])
  })
})

describe('the reader, on a real store', () => {
  const SETTINGS: WorkspaceSettings = { swarm: false, relay: true, relayHopCap: 6, interrupt: false, memoryMode: 'auto', autoMode: false, askConnectors: false, keepATodoList: false, layout: 'auto', tube: 'full', replySize: 'standard' }

  it('makes a tidy reply proposals even in "Keep and tell me", and says what it could not make', async () => {
    const { memories, a, b } = await seeded()
    const reply = `Two say the same thing.\n<locust-tidy>\nmerge ${a.memoryId} ${b.memoryId} :: Deploys go out every Thursday.\nretire mem_gone :: stale\n</locust-tidy>`
    const updates: CodexMissionUpdate[] = []
    const reader = createMemoryReader({
      memories,
      ledger: {
        getMission: async () =>
          ({
            metadata: { missionId: 'mission_tidy', runId: 'run_tidy', workspaceId: 'ws_shop' },
            phase: 'completed',
            events: [{ type: 'message.delta', payload: { itemId: 'm1', operation: 'append', text: reply, final: true } }]
          }) as never
      },
      teammates: {
        list: async () => [{ teammateId: 'tm_wren', name: 'Wren' } as PublicTeammate],
        missionOwners: async (): Promise<Readonly<Record<string, string>>> => ({ mission_tidy: 'tm_wren' }),
        readSettings: async () => SETTINGS
      },
      workspaceName: 'shop',
      notify: (update) => {
        updates.push(update)
      }
    })
    await reader.onRunEnded({ missionId: 'mission_tidy' })
    expect(updates.find((update) => update.kind === 'memory-changed')).toMatchObject({
      by: 'Wren',
      proposedTidy: 1,
      tidyRefused: ['A suggestion to forget a memory named one this folder does not keep.']
    })
    expect((await memories.briefed('ws_shop')).map((memory) => memory.text)).toEqual([a.text, b.text, 'The API is on port 3000.', 'Tests run with npm test.'])
  })
})

/*
 * 0.372: a fenced block is read, a bulleted line is read, and a line that is
 * not a suggestion is SAID -- in the conversation, where the person is
 * reading "Here are my suggestions:" -- rather than dropped in silence.
 */
describe('the reader, on a reply written the way models write', () => {
  const SETTINGS: WorkspaceSettings = { swarm: false, relay: true, relayHopCap: 6, interrupt: false, memoryMode: 'auto', autoMode: false, askConnectors: false, keepATodoList: false, layout: 'auto', tube: 'full', replySize: 'standard' }
  const read = async (reply: Reply) => {
    const { memories, a, b, c } = await seeded()
    const updates: CodexMissionUpdate[] = []
    const reader = createMemoryReader({
      memories,
      ledger: {
        getMission: async () =>
          ({
            metadata: { missionId: 'mission_tidy', runId: 'run_tidy', workspaceId: 'ws_shop' },
            phase: 'completed',
            events: [{ type: 'message.delta', payload: { itemId: 'm1', operation: 'append', text: reply(a.memoryId, b.memoryId, c.memoryId), final: true } }]
          }) as never
      },
      teammates: {
        list: async () => [{ teammateId: 'tm_wren', name: 'Wren' } as PublicTeammate],
        missionOwners: async (): Promise<Readonly<Record<string, string>>> => ({ mission_tidy: 'tm_wren' }),
        readSettings: async () => SETTINGS
      },
      workspaceName: 'shop',
      notify: (update) => {
        updates.push(update)
      }
    })
    await reader.onRunEnded({ missionId: 'mission_tidy' })
    return updates
  }
  type Reply = (a: string, b: string, c: string) => string
  const FENCE = String.fromCharCode(96).repeat(3)

  it('reads a block in a code fence, with bulleted and numbered lines', async () => {
    const reply: Reply = (a, b, c) => `Here are my suggestions:\n\n${FENCE}\n<locust-tidy>\n- merge ${a} ${b} :: Deploys go out every Thursday.\n2. retire ${c} :: the API moved\n</locust-tidy>\n${FENCE}`
    const updates = await read(reply)
    expect(updates.find((update) => update.kind === 'memory-changed')).toMatchObject({ by: 'Wren', proposedTidy: 2 })
    expect(updates.some((update) => update.kind === 'relay-notice')).toBe(false)
  })

  it('says, in the conversation, how many lines it could not read -- and still proposes the rest', async () => {
    const reply: Reply = (a, b) => `Found some.\n<locust-tidy>\nmerge ${a} ${b} :: Deploys go out every Thursday.\nmerge: the two port notes -> one\nretire the old test command\n</locust-tidy>`
    const updates = await read(reply)
    expect(updates.find((update) => update.kind === 'memory-changed')).toMatchObject({ proposedTidy: 1 })
    expect(updates.find((update) => update.kind === 'relay-notice')).toMatchObject({
      kind: 'relay-notice',
      missionId: 'mission_tidy',
      message: "2 of Wren's suggestions were not written in a form Locust reads, so they were not put to you. Ask Wren to write them again, one per line."
    })
  })

  it('says so even when nothing at all could be read', async () => {
    const reply: Reply = () => 'Here are my suggestions:\n<locust-tidy>\nmerge the deploy ones\n</locust-tidy>'
    const updates = await read(reply)
    expect(updates.find((update) => update.kind === 'relay-notice')).toMatchObject({
      message: "One of Wren's suggestions was not written in a form Locust reads, so it was not put to you. Ask Wren to write it again, one per line."
    })
  })

  it('says nothing about the brief’s own example, repeated', async () => {
    const reply: Reply = () => 'Nothing needs tidying. The form was:\n<locust-tidy>\nmerge mem_a mem_b :: the one sentence that replaces them\n</locust-tidy>'
    expect(await read(reply)).toEqual([])
  })
})

describe('the file a teammate reads', () => {
  it('names each memory by its id, so a tidy pass can', () => {
    const text = memoryFileText([{ id: 'mem_abc', text: 'Deploys go out on Thursdays.', scope: 'workspace', by: 'you', where: undefined, at: NOW }], new Date(NOW))
    expect(text).toContain('- Deploys go out on Thursdays. (by the person -- 2026-09-24 (today)) [mem_abc]')
  })
})
