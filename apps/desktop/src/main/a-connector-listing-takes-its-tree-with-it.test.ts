import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A CONNECTOR LISTING THAT TAKES TOO LONG TAKES ITS WHOLE TREE WITH IT
 * (0.485). `execFile`'s own timeout kills only the process it started, and
 * on Windows Cursor's `.cmd` shim makes that a cmd.exe with Cursor's node.exe
 * under it. Measured 2026-09-30: `cursor-agent mcp list` hung on a connector
 * and outlived its app by twenty minutes, still holding a debugging port it
 * had inherited. The listing finds the real `cursor-agent` itself, so the
 * rule is pinned in the source: no `execFile` timeout, and a timer that ends
 * the tree.
 */
const source = readFileSync(join(__dirname, 'cursor-connector-notice.ts'), 'utf8')

describe('the Cursor connector listing', () => {
  it('ends the whole tree when it runs too long, not just the shim', () => {
    expect(source).toMatch(/setTimeout\(\(\) => killProcessTree\(child\.pid\), TIMEOUT_MS\)/)
    expect(source).toContain('clearTimeout(timer)')
  })

  it('does not lean on execFile\'s own timeout, which leaves the tree behind', () => {
    expect(source).not.toMatch(/timeout:\s*TIMEOUT_MS/)
  })
})
