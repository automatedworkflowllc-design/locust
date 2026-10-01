import { describe, expect, it } from 'vitest'

import { parseUnifiedDiff } from './diff.js'
import { asRead, documentChanges } from './documentChange.js'

/**
 * A DOCUMENT'S CHANGE READS AS WORDS (0.530). Sol's 0.528 pass: the change a
 * turn made to a Markdown policy showed `@@`, line numbers, `#` and pipes.
 * The same change, as the passages a reader sees.
 */
const policy = parseUnifiedDiff([
  '--- a/workspace-policy.md',
  '+++ b/workspace-policy.md',
  '@@ -1,8 +1,9 @@',
  ' # Workspace policy',
  ' ',
  '-Requests close at 4 pm on Friday.',
  '+Requests close at 3 pm on Friday.',
  ' ',
  ' | Task | Timing |',
  ' | --- | --- |',
  '-| Cutoff | 4 pm |',
  '+| Cutoff | 3 pm |',
  '+| Review | Monday |',
  '-- Old rule nobody follows',
  ''
].join('\n'))[0]!

describe('a document change reads as words', () => {
  it('names each changed passage with its old words and new words, Markdown marks taken off', () => {
    const passages = documentChanges(policy)
    expect(passages).toEqual([
      { kind: 'changed', before: 'Requests close at ', removed: '4', added: '3', after: ' pm on Friday.' },
      { kind: 'changed', before: 'Cutoff · ', removed: '4', added: '3', after: ' pm' },
      { kind: 'added', text: 'Review · Monday' },
      { kind: 'removed', text: '• Old rule nobody follows' }
    ])
  })

  it('strikes and marks whole words, never the inside of one (drive: "~~Mon~~Tuesday")', () => {
    const day = parseUnifiedDiff(['--- a/p.md', '+++ b/p.md', '@@ -1 +1 @@', '-Ship on Monday', '+Ship on Tuesday', ''].join('\n'))[0]!
    expect(documentChanges(day)).toEqual([{ kind: 'changed', before: 'Ship on ', removed: 'Monday', added: 'Tuesday', after: '' }])
    const middle = parseUnifiedDiff(['--- a/p.md', '+++ b/p.md', '@@ -1 +1 @@', '-We ship slowly today.', '+We ship quickly today.', ''].join('\n'))[0]!
    expect(documentChanges(middle)).toEqual([{ kind: 'changed', before: 'We ship ', removed: 'slowly', added: 'quickly', after: ' today.' }])
  })

  it('reads a heading, a bullet, a quote and a table row as a reader sees them', () => {
    expect(asRead('## Hours')).toBe('Hours')
    expect(asRead('- Bring a badge')).toBe('• Bring a badge')
    expect(asRead('> Note **well**')).toBe('Note well')
    expect(asRead('| a | b \\| c |')).toBe('a · b | c')
    expect(asRead('| --- | :---: |')).toBe('')
  })
})
