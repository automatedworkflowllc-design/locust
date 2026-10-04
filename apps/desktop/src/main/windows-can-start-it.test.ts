import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Nothing in the main process starts a runtime CLI by its bare name.
 *
 * MEASURED 2026-09-13, and it had already shipped: `cursor-connector-notice.ts`
 * ran `execFile('cursor-agent', ['mcp', 'list'])`, which on Windows is
 * `spawn cursor-agent ENOENT` every single time. Cursor installs its launcher
 * as `cursor-agent.cmd`, and `execFile` without a shell will not start a
 * `.cmd`. The call's own catch read that as "no answer about connectors" and
 * said nothing, so a feature written specifically to end days of confusion was
 * silent from the moment it landed, on the only platform this app ships to.
 *
 * The failure is invisible in three ways at once: it needs Windows, it needs a
 * real install, and it looks exactly like the healthy case. So it is a guard
 * rather than a fix — `path-locator.ts` already knows how to find every one of
 * these, including which ones need cmd.exe in front, and the rule is simply to
 * ask it.
 *
 * Passing a resolved `launch.executablePath` is fine and is what this expects.
 * Only a LITERAL runtime name as the program is refused.
 */

const MAIN = fileURLToPath(new URL('./', import.meta.url))

/** Every CLI this app knows how to launch, from `path-locator.ts`'s own roots. */
const RUNTIME_COMMANDS = [
  'cursor-agent',
  'codex',
  'claude',
  'gemini',
  'opencode',
  'copilot',
  'agent'
] as const

const SPAWNS = new RegExp(
  String.raw`\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*(['"])(` +
    RUNTIME_COMMANDS.join('|') +
    String.raw`)\1`,
  'g'
)

function sources(at: string, found: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    const path = join(at, name)
    if (statSync(path).isDirectory()) {
      sources(path, found)
      continue
    }
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

describe('a runtime is launched by resolved path, never by name', () => {
  it('finds no bare-name spawn anywhere in the main process', () => {
    const offenders: string[] = []
    for (const path of sources(MAIN)) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(SPAWNS)) {
        offenders.push(`${path.slice(MAIN.length)}: ${match[2] ?? ''}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('still catches the shape that shipped', () => {
    const shipped = `execFile('cursor-agent', ['mcp', 'list'], {}, () => {})`
    expect([...shipped.matchAll(SPAWNS)].map((m) => m[2])).toEqual(['cursor-agent'])
  })
})
