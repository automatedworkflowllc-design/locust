import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parsedMissionMode } from './mission-mode.js'

/**
 * M26: handoff and resume keep the mode they were asked for. Start read the
 * mode as itself; handoff and resume turned everything but accept-edits
 * into read-only Ask.
 */
describe('the mode a request asks for', () => {
  it('travels as itself when Locust knows it', () => {
    for (const mode of ['ask', 'accept-edits', 'approve-each', 'auto', 'plan'] as const) expect(parsedMissionMode(mode)).toBe(mode)
  })

  it('is read-only Ask when it is missing or malformed', () => {
    for (const value of [undefined, null, '', 'AUTO', 'full-access', 42]) expect(parsedMissionMode(value)).toBe('ask')
  })

  it('is read the same way by start, handoff and resume', () => {
    const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(index.match(/parsedMissionMode\(payload\.mode\)/g)).toHaveLength(3)
    expect(index).not.toContain("payload.mode === 'accept-edits' ? 'accept-edits' : 'ask'")
  })
})
