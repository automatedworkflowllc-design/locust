import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MAX_KEPT_FILE_BYTES, createCheckpoints, createTurnRecords, storeFor } from './checkpoints.js'

/*
 * UNDO A TURN (0.674). Real git, real files: the folder before a turn and after
 * it are kept in a store of Locust's own, and Undo puts back what the turn
 * changed -- only where the file is still as the turn left it.
 */
const made: string[] = []
afterEach(async () => {
  for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true })
})
const temp = async (prefix: string): Promise<string> => {
  const folder = await mkdtemp(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), prefix))
  made.push(folder)
  return folder
}
const setUp = async () => {
  const workspace = await temp('locust-undo-ws-')
  const root = await temp('locust-undo-store-')
  await writeFile(join(workspace, 'notes.txt'), 'one\r\ntwo\r\n')
  await mkdir(join(workspace, 'sub'))
  await writeFile(join(workspace, 'sub', 'keep.md'), 'keep\n')
  await writeFile(join(workspace, 'gone.md'), 'here before\n')
  await writeFile(join(workspace, '.gitignore'), 'node_modules/\n')
  await mkdir(join(workspace, 'node_modules'))
  await writeFile(join(workspace, 'node_modules', 'big.js'), 'ignored\n')
  return { workspace, root, checkpoints: createCheckpoints({ root }) }
}
// The turn: one edit, one new file, one removal.
const turn = async (workspace: string) => {
  await writeFile(join(workspace, 'notes.txt'), 'one\r\nTWO\r\n')
  await writeFile(join(workspace, 'made.md'), 'new\n')
  await rm(join(workspace, 'gone.md'))
}

describe('a turn, undone', () => {
  it('names what the turn changed, and nothing git ignores', async () => {
    const { workspace, checkpoints } = await setUp()
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    await writeFile(join(workspace, 'node_modules', 'big.js'), 'changed but ignored\n')
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    expect([...(await checkpoints.changed(workspace, before.commit, after.commit))].sort()).toEqual(['gone.md', 'made.md', 'notes.txt'])
  })

  it('puts every file back, byte for byte: the edit, the new file, the removed one', async () => {
    const { workspace, checkpoints } = await setUp()
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    const result = await checkpoints.undo(workspace, before.commit, after.commit)
    expect([...result.restored].sort()).toEqual(['gone.md', 'made.md', 'notes.txt'])
    expect(result.leftAlone).toEqual([])
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('one\r\ntwo\r\n')
    expect(existsSync(join(workspace, 'made.md'))).toBe(false)
    expect(await readFile(join(workspace, 'gone.md'), 'utf8')).toBe('here before\n')
    expect(await readFile(join(workspace, 'sub', 'keep.md'), 'utf8')).toBe('keep\n')
  })

  it('leaves alone a file changed since the turn, and says so', async () => {
    const { workspace, checkpoints } = await setUp()
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    await writeFile(join(workspace, 'notes.txt'), 'the person wrote this after\n')
    const result = await checkpoints.undo(workspace, before.commit, after.commit)
    expect(result.leftAlone).toEqual([{ path: 'notes.txt', why: 'changed since the turn' }])
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('the person wrote this after\n')
    expect([...result.restored].sort()).toEqual(['gone.md', 'made.md'])
  })

  it('keeps nothing of the person\'s repository: the store is under its own root', async () => {
    const { workspace, root, checkpoints } = await setUp()
    await checkpoints.take(workspace)
    expect(existsSync(join(workspace, '.git'))).toBe(false)
    expect(existsSync(storeFor(root, workspace))).toBe(true)
  })

  it('names a file too large to keep instead of keeping it', async () => {
    const { workspace, checkpoints } = await setUp()
    await writeFile(join(workspace, 'data.bin'), Buffer.alloc(MAX_KEPT_FILE_BYTES + 1))
    const kept = await checkpoints.take(workspace)
    expect(kept.ok && kept.notKept).toEqual(['data.bin'])
  })
})

describe("a turn's record", () => {
  it('is ready with its count, then undone once, and says what it did', async () => {
    const { workspace, root, checkpoints } = await setUp()
    const records = createTurnRecords(join(root, 'turns.json'))
    const before = await checkpoints.take(workspace)
    await turn(workspace)
    const after = await checkpoints.take(workspace)
    if (!before.ok || !after.ok) throw new Error('not kept')
    await records.put('run_1', { workspace, before: before.commit, after: after.commit, at: '2026-10-06T00:00:00.000Z', notKept: [] })
    expect(await records.state('run_1', checkpoints)).toEqual({ kind: 'ready', files: 3, notKept: [] })
    const done = await records.undo('run_1', checkpoints, () => new Date('2026-10-06T01:00:00.000Z'))
    expect(done).toMatchObject({ kind: 'undone', at: '2026-10-06T01:00:00.000Z' })
    // Asked again, it does nothing a second time.
    await writeFile(join(workspace, 'made.md'), 'made again by hand\n')
    expect(await records.undo('run_1', checkpoints, () => new Date())).toMatchObject({ kind: 'undone', at: '2026-10-06T01:00:00.000Z' })
    expect(await readFile(join(workspace, 'made.md'), 'utf8')).toBe('made again by hand\n')
  })

  it('a turn that shared its folder with another run is not offered', async () => {
    const { workspace, root, checkpoints } = await setUp()
    const records = createTurnRecords(join(root, 'turns.json'))
    await records.put('run_2', { workspace, before: 'x', after: 'y', at: '2026-10-06T00:00:00.000Z', notKept: [], shared: true })
    expect(await records.state('run_2', checkpoints)).toEqual({ kind: 'shared' })
  })
})
