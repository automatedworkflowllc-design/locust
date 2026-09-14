import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No second table of mode copy anywhere in the renderer.
 *
 * There were four -- the composer's picker rows, `modeLabel`, `modeSentence`,
 * `modeSummary` -- and they had already drifted on casing and on whether Ask
 * is read-only (Grok's audit, 2026-09-13). `MODE_FACTS` in `status.ts` is the
 * one table now; `mode-says-one-thing.test.ts` checks that it agrees with
 * itself, and this checks that nobody has started a second one.
 *
 * The sweep is here rather than beside that test because it reads the disk,
 * and the renderer's tsconfig has no node types. Proven against the code it
 * was written for: `IdleTeammate.tsx` and `NewTeammateDialog.tsx` each held
 * one of these switches at HEAD on the day it was written.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

describe('one table of modes', () => {
  it('leaves no second table of mode copy in the renderer', () => {
    const offenders: string[] = []
    const walk = (at: string): void => {
      for (const name of readdirSync(at)) {
        const path = join(at, name)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
        if (name.includes('.test.')) continue
        if (path.endsWith(join('renderer', 'src', 'status.ts'))) continue
        const text = readFileSync(path, 'utf8')
        // A switch or an object literal keyed by the mode ids is a table.
        if (/(?:case\s+)?'accept-edits'\s*:/.test(text)) offenders.push(path.slice(RENDERER.length))
      }
    }
    walk(RENDERER)
    expect(offenders).toEqual([])
  })
})
