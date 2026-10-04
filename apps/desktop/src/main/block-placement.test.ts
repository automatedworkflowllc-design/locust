import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BLOCK_PLACEMENT } from '../shared/trailer.js'

/**
 * No briefing may claim its block is the last thing in the reply.
 *
 * Four briefings each told the model to end its reply with a block "and
 * nothing after it" -- the memory block, the ask, the room task and the share.
 * Each is sensible alone and together they cannot all be obeyed, so a turn
 * that both learned something and needed to tell a teammate dropped one of
 * them. A Cursor teammate reading this source from inside Locust reported it
 * on 2026-09-08: "That matches how this product actually loses peer messages:
 * the runtime never wrote the block."
 *
 * The host never cared about order; every parser scans the whole transcript.
 * This test exists because the defect was four people writing the same
 * sentence four times without noticing the other three.
 */
const SOURCES = [
  'main/workroom-briefing.ts',
  'shared/memory.ts',
  'shared/room-task.ts',
  'main/relay.ts'
]

/*
 * Resolved from THIS file, not from the working directory.
 *
 * It used to be `join(process.cwd(), 'apps/desktop/src', file)`, which is only
 * right when vitest is started from the repository root. The ship gate starts
 * it there, so the gate was green; `pnpm test` starts it in apps/desktop, so
 * the path doubled to apps/desktop/apps/desktop and every case in this file
 * failed on ENOENT. The two ways of running the suite disagreed, and the one
 * that guarded releases was the one that happened to pass.
 */
const SRC = fileURLToPath(new URL('../', import.meta.url))
const read = (file: string): string => readFileSync(join(SRC, file), 'utf8')

describe('how briefings tell a model to place its blocks', () => {
  it('finds the briefings, so a pass means something', () => {
    // The control: a wrong path would make every assertion below vacuous.
    for (const file of SOURCES) expect(read(file).length, file).toBeGreaterThan(200)
  })

  it('never says a block must be the last thing in the reply', () => {
    for (const file of SOURCES) {
      expect(read(file), file).not.toMatch(/nothing after it/i)
    }
  })

  it('says instead that several blocks may follow one another', () => {
    expect(BLOCK_PLACEMENT).toMatch(/one after another/i)
    expect(BLOCK_PLACEMENT).toMatch(/any order/i)
  })

  it('is used by every briefing that asks for a block', () => {
    for (const file of ['main/workroom-briefing.ts', 'shared/memory.ts', 'shared/room-task.ts']) {
      expect(read(file), file).toContain('BLOCK_PLACEMENT')
    }
  })
})
