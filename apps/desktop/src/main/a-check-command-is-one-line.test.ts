import { describe, expect, it } from 'vitest'

import { parsedCheckCommand } from './teammate-store.js'

/** A3.3: the check command is kept as typed, and only as one bounded line. */
describe('a check command', () => {
  it('is kept as the person typed it, trimmed', () => {
    expect(parsedCheckCommand('  npm test -- --run  ')).toBe('npm test -- --run')
  })

  it('is nothing when empty, too long, not text, or more than one line', () => {
    expect(parsedCheckCommand('')).toBeUndefined()
    expect(parsedCheckCommand('   ')).toBeUndefined()
    expect(parsedCheckCommand('x'.repeat(501))).toBeUndefined()
    expect(parsedCheckCommand(42)).toBeUndefined()
    expect(parsedCheckCommand(['npm', 'test'].join(String.fromCharCode(10)))).toBeUndefined()
    expect(parsedCheckCommand(['npm', 'test'].join(String.fromCharCode(0)))).toBeUndefined()
  })
})
