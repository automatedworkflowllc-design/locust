import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every harness under `_tools/` parses.
 *
 * Not a style check -- a syntax one, and it exists because of a failure that
 * happened THREE times on 2026-09-08 alone. A drive builds its browser script
 * as a JavaScript template literal, and a backtick anywhere inside it ends
 * that literal early. The commonest source is not code: it is a COMMENT that
 * quotes an identifier, exactly the way the rest of this codebase writes
 * comments.
 *
 * The failure is quiet in the worst way. `node file.mjs` reports it only when
 * that file is run, and a drive is run by hand, days apart, usually while
 * chasing something else -- so the error arrives attached to whatever was
 * being investigated at the time. The third occurrence cost a full edit cycle
 * on a fix that was already correct.
 *
 * It lives beside the main-process sources rather than in shared/, because it
 * needs node types and shared/ is compiled by the WEB config, which has none.
 * It was written there first and the ship gate caught it: the repo-wide
 * typecheck runs configs that a single hand-run tsc invocation does not, so
 * "I typechecked it" was true and insufficient.
 *
 * A memory would not have caught it; a check that runs with every suite does.
 * `--check` parses without executing, so nothing here launches an app, spends
 * a quota or touches a runtime.
 */

const TOOLS = fileURLToPath(new URL('../../../../_tools/', import.meta.url))

const harnesses = readdirSync(TOOLS)
  .filter((name) => name.endsWith('.mjs'))
  .sort()

describe('every drive and probe under _tools parses', () => {
  it('finds harnesses to check at all', () => {
    // Without this, a wrong path would make the suite below vacuously green --
    // zero files, zero failures, and no coverage of anything.
    expect(harnesses.length).toBeGreaterThan(20)
  })

  it.each(harnesses)('%s', (name: string) => {
    expect(() => {
      execFileSync(process.execPath, ['--check', join(TOOLS, name)], { stdio: 'pipe' })
    }).not.toThrow()
  })
})
