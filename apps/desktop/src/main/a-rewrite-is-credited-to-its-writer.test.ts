import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MEMORY_FILE, MEMORY_OFF_TEXT, retireMemoryFile } from './memory-file.js'
import { createMemoryStore } from './memory-store.js'

/*
 * A REWRITE IS CREDITED TO ITS WRITER (A1.6), and MEMORY OFF MEANS THE FILE
 * SAYS SO (A1.7).
 *
 * A1.6: a rewritten memory kept only `by` -- who first kept it -- so after
 * "Keep the change", Booty's "Deploys go out on Thursdays" read "you" on the
 * Memory screen (the 0.315 drive), and the brief and the file said the same.
 */

const NOW = '2026-09-24T12:00:00.000Z'
let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function store() {
  root = await mkdtemp(join(tmpdir(), 'locust-credit-'))
  let ids = 0
  return createMemoryStore({ rootDirectory: root, now: () => new Date(NOW), createId: () => `id${String(++ids)}` })
}

const YOU = { name: 'you' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty' }
const SHOP = { workspaceId: 'ws_shop', workspaceName: 'shop' }

describe('who wrote the words', () => {
  it('a teammate’s rewrite ("Keep and tell me"): credited to the teammate; `by` stays who first kept it', async () => {
    const memories = await store()
    await memories.add({ text: 'Deploys go out on Fridays.', scope: 'workspace', ...SHOP, by: YOU, status: 'kept', name: 'deploy-day' })
    const { memory } = await memories.add({ text: 'Deploys go out on Thursdays.', scope: 'workspace', ...SHOP, by: BOOTY, status: 'kept', name: 'deploy-day' })
    expect(memory.by).toEqual(YOU)
    expect(memory.updatedBy).toEqual(BOOTY)
    // And it survives the file.
    expect((await memories.list())[0]?.updatedBy).toEqual(BOOTY)
  })

  it('a change the person kept ("Keep the change"): credited to the teammate who proposed it', async () => {
    const memories = await store()
    await memories.add({ text: 'Deploys go out on Fridays.', scope: 'workspace', ...SHOP, by: YOU, status: 'kept', name: 'deploy-day' })
    const { memory: proposal } = await memories.add({ text: 'Deploys go out on Thursdays.', scope: 'workspace', ...SHOP, by: BOOTY, status: 'proposed', name: 'deploy-day' })
    const changed = await memories.update({ memoryId: proposal.memoryId, keep: true })
    expect(changed.updatedBy).toEqual(BOOTY)
  })

  it('the person’s own edit, and Put it back: credited to the person', async () => {
    const memories = await store()
    await memories.add({ text: 'Deploys go out on Fridays.', scope: 'workspace', ...SHOP, by: BOOTY, status: 'kept' })
    const [held] = await memories.list()
    const edited = await memories.update({ memoryId: held!.memoryId, text: 'Deploys go out on Mondays.' })
    expect(edited.updatedBy).toEqual(YOU)
    // Switching it off writes no words, so credits nobody new.
    const off = await memories.update({ memoryId: held!.memoryId, enabled: false })
    expect(off.updatedBy).toEqual(YOU)
  })

  it('a writer in the file that does not read is dropped, not trusted', async () => {
    const memories = await store()
    const memory = { memoryId: 'mem_a', text: 'Kept.', scope: 'workspace', ...SHOP, by: YOU, createdAt: NOW, status: 'kept', enabled: true, updatedBy: { name: '' } }
    await writeFile(join(root!, 'memories.json'), JSON.stringify({ schemaVersion: 1, memories: [memory] }), 'utf8')
    expect((await memories.list())[0]?.updatedBy).toBeUndefined()
  })
})

describe('memory switched off (A1.7)', () => {
  const fake = (files: Record<string, string>) => {
    const writes: Record<string, string> = {}
    return {
      writes,
      io: {
        readFile: async (path: string) => {
          const held = files[path.replace(/\\/g, '/')]
          if (held === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          return held
        },
        writeFile: async (path: string, text: string) => {
          writes[path.replace(/\\/g, '/')] = text
        },
        mkdir: async () => undefined
      }
    }
  }
  const PATH = `C:/work/${MEMORY_FILE.replace(/\\/g, '/')}`

  it('rewrites a file that still lists memories, so a teammate cannot read them there', async () => {
    const held = fake({ [PATH]: '# Team memory\n\n- The secret word is PELICAN. (by the person -- 2026-09-05)\n' })
    expect(await retireMemoryFile('C:\\work', held.io)).toBe(true)
    expect(held.writes[PATH]).toBe(MEMORY_OFF_TEXT)
    expect(MEMORY_OFF_TEXT).not.toContain('PELICAN')
  })

  it('writes nothing in a folder that never had the file, or where it already says so', async () => {
    const none = fake({})
    expect(await retireMemoryFile('C:\\work', none.io)).toBe(false)
    expect(none.writes).toEqual({})
    const already = fake({ [PATH]: MEMORY_OFF_TEXT })
    expect(await retireMemoryFile('C:\\work', already.io)).toBe(false)
    expect(already.writes).toEqual({})
  })
})
