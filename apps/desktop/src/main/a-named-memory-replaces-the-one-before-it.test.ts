import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryStore } from './memory-store.js'
import { memoryName, parseMemoryBlocks } from '../shared/memory.js'

/**
 * Measured on Colin's own store, 2026-09-21: **89 memories, 26 of them in a
 * near-duplicate pair**, and the worst of those was one teammate writing
 *
 * > On Locust 0.224.0 orb round 4, unit tests 31/31; Luna Thinking→Composing…
 * > On Locust 0.226.0 orb round 6, unit tests 31/31; Luna Thinking→Composing…
 *
 * eight times, once per test round — a fact with exactly one current value,
 * stored nine ways. At 23 and 27 new memories on the two days before that,
 * against a 400 cap.
 *
 * The fix is NOT similarity matching. Neither Grok Build nor Builder.io's
 * agent-native does that to memories, and inferring that two sentences mean
 * the same thing is how a store starts deleting what nobody agreed to lose.
 * Identity is **asserted by the writer**: a memory given a name replaces the
 * one before it under that name.
 */

const roots: string[] = []
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'locust-named-'))
  roots.push(root)
  return createMemoryStore({ rootDirectory: root })
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const WHERE = { workspaceId: 'ws_one', workspaceName: 'scratch', by: { name: 'Yurt' }, status: 'kept' as const }

describe('the block understands a name', () => {
  it('reads `remember as <name> ::`', () => {
    expect(parseMemoryBlocks('<locust-memory>\nremember as orb-suite-status :: round 10, 38/38\n</locust-memory>')).toEqual([
      { kind: 'remember', scope: 'workspace', text: 'round 10, 38/38', name: 'orb-suite-status' }
    ])
  })

  it('reads the everywhere form, and still reads the unnamed ones exactly as before', () => {
    const ops = parseMemoryBlocks(
      '<locust-memory>\nremember everywhere as house-style :: diffs, not prose\nremember :: tests run with pnpm\nforget :: the API is on port 3000\n</locust-memory>'
    )
    expect(ops).toEqual([
      { kind: 'remember', scope: 'global', text: 'diffs, not prose', name: 'house-style' },
      { kind: 'remember', scope: 'workspace', text: 'tests run with pnpm' },
      { kind: 'forget', text: 'the API is on port 3000' }
    ])
  })

  it('refuses a name that is not a slug, keeping the memory rather than the name', () => {
    expect(memoryName('Orb Suite Status')).toBeUndefined()
    expect(memoryName('orb-suite-status')).toBe('orb-suite-status')
    expect(memoryName('ORB-Suite')).toBe('orb-suite')
    expect(memoryName('-leading')).toBeUndefined()
    expect(memoryName('a'.repeat(65))).toBeUndefined()
  })

  it('does not let `forget` take a name: it quotes, it does not file', () => {
    const ops = parseMemoryBlocks('<locust-memory>\nforget as thing :: the API is on port 3000\n</locust-memory>')
    expect(ops).toEqual([{ kind: 'forget', text: 'the API is on port 3000' }])
  })
})

describe('a named memory replaces the one before it', () => {
  it('rewrites in place: one row, the new words, the old ones kept', async () => {
    const memories = await store()
    const first = await memories.add({ ...WHERE, text: 'orb round 4, tests 31/31', scope: 'workspace', name: 'orb-suite-status' })
    const second = await memories.add({ ...WHERE, text: 'orb round 10, tests 38/38', scope: 'workspace', name: 'orb-suite-status' })
    expect(second.created).toBe(false)
    expect(second.rewritten).toBe(true)
    // The same row: the id, the author and the birthday survive a rewrite.
    expect(second.memory.memoryId).toBe(first.memory.memoryId)
    expect(second.memory.createdAt).toBe(first.memory.createdAt)
    expect(second.memory.text).toBe('orb round 10, tests 38/38')
    expect(second.memory.previousText).toBe('orb round 4, tests 31/31')
    expect(await memories.list()).toHaveLength(1)
  })

  it('is what stops the store growing: nine rounds, one memory', async () => {
    const memories = await store()
    for (const round of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      await memories.add({ ...WHERE, text: `orb round ${String(round)}, tests 38/38`, scope: 'workspace', name: 'orb-suite-status' })
    }
    const listed = await memories.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.text).toBe('orb round 12, tests 38/38')
  })

  it('leaves an unnamed memory behaving exactly as it always did', async () => {
    const memories = await store()
    await memories.add({ ...WHERE, text: 'tests run with pnpm', scope: 'workspace' })
    const again = await memories.add({ ...WHERE, text: 'Tests run with pnpm.', scope: 'workspace' })
    // Same text, punctuation-blind: de-duplicated, not rewritten.
    expect(again.created).toBe(false)
    expect(again.rewritten).toBeUndefined()
    expect(await memories.list()).toHaveLength(1)
  })

  it('does not churn the file when the same name is given the same words', async () => {
    const memories = await store()
    await memories.add({ ...WHERE, text: 'round 10, 38/38', scope: 'workspace', name: 'orb-suite-status' })
    const same = await memories.add({ ...WHERE, text: 'round 10, 38/38', scope: 'workspace', name: 'orb-suite-status' })
    expect(same.rewritten).toBeUndefined()
    expect(same.memory.previousText).toBeUndefined()
    expect(same.memory.updatedAt).toBeUndefined()
  })

  it('keeps a name to its own place: this folder and everywhere are different memories', async () => {
    const memories = await store()
    await memories.add({ ...WHERE, text: 'here', scope: 'workspace', name: 'status' })
    await memories.add({ ...WHERE, text: 'anywhere', scope: 'global', name: 'status' })
    const listed = await memories.list()
    expect(listed).toHaveLength(2)
    expect(listed.map((memory) => memory.text).sort()).toEqual(['anywhere', 'here'])
  })

  it('does not promote a proposed memory by rewriting it', async () => {
    // `memoryMode: 'ask'` exists so a person sees a memory before it counts.
    // A name must not be a way around that.
    const memories = await store()
    await memories.add({ ...WHERE, status: 'proposed', text: 'first', scope: 'workspace', name: 'thing' })
    const after = await memories.add({ ...WHERE, status: 'kept', text: 'second', scope: 'workspace', name: 'thing' })
    expect(after.memory.status).toBe('proposed')
  })

  it('survives a reload, name and history intact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-named-'))
    roots.push(root)
    const first = createMemoryStore({ rootDirectory: root })
    await first.add({ ...WHERE, text: 'one', scope: 'workspace', name: 'thing' })
    await first.add({ ...WHERE, text: 'two', scope: 'workspace', name: 'thing' })
    const listed = await createMemoryStore({ rootDirectory: root }).list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('thing')
    expect(listed[0]?.text).toBe('two')
    expect(listed[0]?.previousText).toBe('one')
  })
})
