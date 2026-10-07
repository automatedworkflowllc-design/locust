import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MAX_OBSERVED_FILE_BYTES, observedPatches, snapshotFolder } from './disk-observation.js'

/**
 * A LARGE FILE IN A PLAIN FOLDER SHOWS ITS CHANGE (0.695).
 *
 * In a folder that is not a git repository the host keeps a file's text
 * before the turn only up to 64 KB, so a one-line change to a larger one read
 * "changed · seen on disk" -- on every agent that does not report its own
 * diff (Antigravity's stream names only the file, measured 2026-10-07). The
 * turn's Undo checkpoint already holds the file as it was; it is asked.
 */
const made: string[] = []
afterEach(async () => {
  for (const folder of made.splice(0)) await rm(folder, { recursive: true, force: true })
})

const big = (second: string): string =>
  `line one\n${second}\nline three\n${Array.from({ length: 3000 }, (_, at) => `filler ${String(at)}, there only to make the file large.`).join('\n')}\n`

describe('a large file changed in a plain folder', () => {
  it('reads as one line changed when the checkpoint has it from before', async () => {
    const workspace = await mkdtemp(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), 'locust-plain-large-'))
    made.push(workspace)
    const original = big('line two')
    expect(Buffer.byteLength(original)).toBeGreaterThan(MAX_OBSERVED_FILE_BYTES)
    await writeFile(join(workspace, 'notes.txt'), original, 'utf8')
    const before = await snapshotFolder(workspace)
    await writeFile(join(workspace, 'notes.txt'), big('line 2'), 'utf8')
    const after = await snapshotFolder(workspace)
    expect(before).toBeDefined()
    expect(after).toBeDefined()

    const without = await observedPatches(workspace, after!, ['notes.txt'], {}, before)
    expect(without.get('notes.txt')).toBeUndefined()

    const asked: string[] = []
    const withCheckpoint = await observedPatches(workspace, after!, ['notes.txt'], {
      beforeText: async (path) => { asked.push(path); return original }
    }, before)
    expect(asked).toEqual(['notes.txt'])
    expect(withCheckpoint.get('notes.txt')).toMatchObject({ added: 1, removed: 1 })
  })

  it('is read back from a real checkpoint as it was, after the file changed', async () => {
    const { createCheckpoints } = await import('./checkpoints.js')
    const workspace = await mkdtemp(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), 'locust-plain-large-'))
    const root = await mkdtemp(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), 'locust-plain-store-'))
    made.push(workspace, root)
    const original = big('line two')
    await writeFile(join(workspace, 'notes.txt'), original, 'utf8')
    const checkpoints = createCheckpoints({ root })
    const kept = await checkpoints.take(workspace)
    if (!kept.ok) throw new Error(kept.why)
    await writeFile(join(workspace, 'notes.txt'), big('line 2'), 'utf8')
    expect(await checkpoints.fileAt(workspace, kept.commit, 'notes.txt')).toBe(original)
    // Never outside the folder, never a made-up commit.
    expect(await checkpoints.fileAt(workspace, kept.commit, '../outside.txt')).toBeUndefined()
    expect(await checkpoints.fileAt(workspace, 'HEAD', 'notes.txt')).toBeUndefined()
  })
})
