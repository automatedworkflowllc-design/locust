import { describe, expect, it } from 'vitest'

import { unwrapProtocolTags } from './protocolTags.js'

/**
 * L7 (the code review): the torn-tag pattern was written in a template
 * literal as a backslash-s, which a template turns into a plain `s` -- so
 * the cleanup deleted every s before a tag cut off at the end of a stream.
 */
describe('a tag cut off at the end of a stream', () => {
  it('is removed, and the s letters before it are kept', () => {
    // Touching the tag, as a stream cut mid-word leaves it: the old pattern
    // ate these s's, "pass" came back "pa".
    expect(unwrapProtocolTags('Yes, the tests pass<locust-sh')).toBe('Yes, the tests pass')
    expect(unwrapProtocolTags('Done: 3 files<locu')).toBe('Done: 3 files')
    expect(unwrapProtocolTags('Yes, the tests pass <locust-sh')).toBe('Yes, the tests pass')
    expect(unwrapProtocolTags('It works.' + String.fromCharCode(10) + '</locu')).toBe('It works.')
    expect(unwrapProtocolTags('Tests pass')).toBe('Tests pass')
  })
})
