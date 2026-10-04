import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A failure sentence says what is still true.
 *
 * This is `RULING-2026-09-11-SCOPE-NOT-ABSENCE.md` applied to the catch paths.
 * "That room could not be renamed." is a complete account of the request and
 * no account at all of the room: a reader cannot tell a refused request from a
 * half-applied one, and the half-applied reading is the one people assume,
 * because it is the one that would hurt. So every one of these carries a
 * second clause naming what did NOT change (Grok's audit, 2026-09-13).
 *
 * Eleven sentences were bare when this was written. One was not -- the peer
 * message notice, which already ended "Whatever was waiting is still waiting."
 * -- and it is the model the rest were rewritten to.
 *
 * Lives with the other guards rather than in the renderer because it reads
 * the disk, and the renderer's tsconfig carries no node types.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

/** A single-sentence "could not" with nothing after it. */
const BARE = /'[^']*could not be [a-z]+\.'/g

function sources(at: string, found: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    const path = join(at, name)
    if (statSync(path).isDirectory()) {
      sources(path, found)
      continue
    }
    if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.includes('.test.')) found.push(path)
  }
  return found
}

describe('what is still true', () => {
  it('leaves no failure sentence that stops at the failure', () => {
    const offenders: string[] = []
    for (const path of sources(RENDERER)) {
      for (const match of readFileSync(path, 'utf8').matchAll(BARE)) {
        offenders.push(`${path.slice(RENDERER.length)}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('still catches the shape that shipped', () => {
    expect([...`setRoomNotice('That room could not be renamed.')`.matchAll(BARE)]).toHaveLength(1)
    // And passes the rewritten one, which is the point of the second clause.
    expect([
      ...`'That room could not be renamed. It kept the name it had.'`.matchAll(BARE)
    ]).toHaveLength(0)
  })
})
