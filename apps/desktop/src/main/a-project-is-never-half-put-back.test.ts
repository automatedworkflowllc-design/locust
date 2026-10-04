import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * ALL OF THEM, OR NONE (0.512). Sol's long pass on 0.509: an edit with "Also
 * put back" ticked put back six of eight files; the other two had changes
 * recorded without their lines. The six removed src/storage.js, which one of
 * the two still imported, and the project's tests failed before the new
 * reply had done anything. Each file was exact; the set was not.
 *
 * Driven end to end by _tools/drive-an-edit-puts-files-back.mjs (a file
 * changed by hand holds the rest back; a set that can all go back does). This
 * pins the two halves a drive cannot reach on demand: the window's own check
 * before anything is offered, and the host's undo of a write that failed.
 */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const HOST = read('./index.ts')
const APP = read('../renderer/src/App.tsx')
const COMPOSER = read('../renderer/src/components/Composer.tsx')

describe('a project is never half put back', () => {
  it('the host writes nothing when any file cannot go back, and says which could have', () => {
    expect(HOST).toContain('if (leftAlone.length > 0) return { putBack: [], leftAlone, heldBack: writes.map((write) => write.path) }')
    // Checked before the first write, not after.
    expect(HOST.indexOf('if (leftAlone.length > 0) return { putBack: [], leftAlone, heldBack')).toBeLessThan(HOST.indexOf('for (const write of writes) {'))
  })

  it('a write that fails puts the ones already written back as they were', () => {
    expect(HOST).toMatch(/for \(const undo of done\.reverse\(\)\) \{\s+try \{\s+if \(undo\.was === undefined\) await rm\(undo\.full, \{ force: true \}\)\s+else await writeFile\(undo\.full, undo\.was, 'utf8'\)/)
  })

  it('the window offers nothing to tick when it already knows some cannot go back, and says why', () => {
    expect(APP).toContain("rewinding.files.some((file) => file.cannot !== undefined)")
    expect(APP).toContain('filesHeld: { total: rewinding.files.length, cannot:')
    expect(COMPOSER).toContain('files the replies changed cannot be put back exactly, and putting back only the others could leave the project half changed.')
  })
})
