import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AWAY_FILE, attentionMarkFrom, readAttentionMark, writeAttentionMark } from './away.js'

/*
 * AN ATTENTION MARK SAYS WHEN YOU WERE LAST HERE (0.590, PRD R17). The main
 * process writes the moment the window last had the person; the next start
 * reads it and, if long enough ago, Home says what happened since. Missing or
 * unreadable means nobody was here before: no list, no guess.
 */

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'locust-away-'))
  roots.push(root)
  return join(root, 'profile', AWAY_FILE)
}

describe('the attention mark', () => {
  it('reads back what was written, making the folder on the way, and leaves no half-written file', () => {
    const file = scratch()
    expect(readAttentionMark(file)).toBeUndefined()
    writeAttentionMark(file, '2026-10-04T01:00:00.000Z')
    expect(readAttentionMark(file)).toBe('2026-10-04T01:00:00.000Z')
    expect(readFileSync(file, 'utf8')).toBe('{"at":"2026-10-04T01:00:00.000Z"}\n')
    expect(() => readFileSync(`${file}.tmp`)).toThrow()
    writeAttentionMark(file, '2026-10-04T02:00:00.000Z')
    expect(readAttentionMark(file)).toBe('2026-10-04T02:00:00.000Z')
  })

  it('treats a file it cannot read as no mark (control)', () => {
    const file = scratch()
    writeAttentionMark(file, '2026-10-04T01:00:00.000Z')
    writeFileSync(file, '{ not json', 'utf8')
    expect(readAttentionMark(file)).toBeUndefined()
    expect(attentionMarkFrom({ at: 'yesterday' })).toBeUndefined()
    expect(attentionMarkFrom({ at: 12 })).toBeUndefined()
    expect(attentionMarkFrom(null)).toBeUndefined()
    expect(attentionMarkFrom({ at: '2026-10-04T01:00:00.000Z' })).toBe('2026-10-04T01:00:00.000Z')
  })
})
