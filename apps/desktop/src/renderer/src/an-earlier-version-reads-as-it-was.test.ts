import { describe, expect, it } from 'vitest'

import { parseUnifiedDiff } from './diff.js'
import { fileAsItWas } from './fileVersions.js'
import type { FileTurn } from './missionView.js'

/**
 * AN EARLIER VERSION READS AS IT WAS (0.517).
 *
 * Sol, Workflow 2: an older version of a document opened as a code diff.
 * Rebuilt by undoing each later turn's recorded change, exactly or not at
 * all (shared/reverse-diff.ts).
 */
const turn = (diff: string, truncated = false): FileTurn => {
  const file = parseUnifiedDiff(diff)[0]
  if (file === undefined) throw new Error('no file in the diff')
  return { missionId: 'm', prompt: 'p', file, counts: { added: 0, removed: 0 }, truncated, reported: undefined } as unknown as FileTurn
}

// Made, then a word changed, then a line added.
const made = turn('diff --git a/plan.md b/plan.md\nnew file mode 100644\n--- /dev/null\n+++ b/plan.md\n@@ -0,0 +1,2 @@\n+# Plan\n+Ship on Monday\n')
const changed = turn('diff --git a/plan.md b/plan.md\n--- a/plan.md\n+++ b/plan.md\n@@ -1,2 +1,2 @@\n # Plan\n-Ship on Monday\n+Ship on Tuesday\n')
const added = turn('diff --git a/plan.md b/plan.md\n--- a/plan.md\n+++ b/plan.md\n@@ -1,2 +1,3 @@\n # Plan\n Ship on Tuesday\n+Tell the team\n')
const now = '# Plan\nShip on Tuesday\nTell the team\n'

describe('an earlier version of a file, as it was', () => {
  it('after each turn, from the file as it is now', () => {
    expect(fileAsItWas(now, [made, changed, added], 0)).toEqual({ ok: true, next: '# Plan\nShip on Monday\n' })
    expect(fileAsItWas(now, [made, changed, added], 1)).toEqual({ ok: true, next: '# Plan\nShip on Tuesday\n' })
    expect(fileAsItWas(now, [made, changed, added], 2)).toEqual({ ok: true, next: now })
  })

  it('is not rebuilt when a later change was recorded cut short, and says so', () => {
    expect(fileAsItWas(now, [made, changed, turn('diff --git a/plan.md b/plan.md\n--- a/plan.md\n+++ b/plan.md\n@@ -1,2 +1,3 @@\n # Plan\n Ship on Tuesday\n+Tell the team\n', true)], 0)).toEqual({ ok: false, why: 'a later change to it was recorded cut short' })
  })

  it('is not rebuilt when the file was changed since, rather than rebuilt wrong', () => {
    const editedSince = '# Plan\nShip on Wednesday\nTell the team\n'
    const result = fileAsItWas(editedSince, [made, changed, added], 0)
    expect(result.ok).toBe(false)
  })

  it('keeps Windows line endings', () => {
    expect(fileAsItWas(now.replace(/\n/g, '\r\n'), [made, changed, added], 1)).toEqual({ ok: true, next: '# Plan\r\nShip on Tuesday\r\n' })
  })
})
