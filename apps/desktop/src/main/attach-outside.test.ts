import { describe, expect, it } from 'vitest'

import { ATTACHMENT_DIR, attachmentDestination, excludeWith, GIT_EXCLUDE_LINE } from './attach-outside.js'

describe('finding a home for a file from outside the workspace', () => {
  it('keeps the name it had', () => {
    expect(attachmentDestination('C:\\Users\\c\\Downloads\\report.pdf', new Set())).toBe(
      `${ATTACHMENT_DIR}/report.pdf`
    )
    expect(attachmentDestination('/home/c/shot.png', new Set())).toBe(`${ATTACHMENT_DIR}/shot.png`)
  })

  it('never overwrites a file already there', () => {
    // THE test. Two `notes.md` from two folders is the ordinary case, and
    // silently overwriting would send the same file twice while showing two
    // tiles -- the app claiming something that did not happen.
    expect(attachmentDestination('/a/notes.md', new Set(['notes.md']))).toBe(`${ATTACHMENT_DIR}/notes-2.md`)
    expect(attachmentDestination('/b/notes.md', new Set(['notes.md', 'notes-2.md']))).toBe(
      `${ATTACHMENT_DIR}/notes-3.md`
    )
  })

  it('handles a name with no extension, and one with several dots', () => {
    expect(attachmentDestination('/a/README', new Set(['README']))).toBe(`${ATTACHMENT_DIR}/README-2`)
    expect(attachmentDestination('/a/archive.tar.gz', new Set(['archive.tar.gz']))).toBe(
      `${ATTACHMENT_DIR}/archive.tar-2.gz`
    )
  })
})

describe('keeping the folder out of git', () => {
  it('adds the line to an exclude file that lacks it', () => {
    expect(excludeWith('')).toBe(`${GIT_EXCLUDE_LINE}\n`)
    expect(excludeWith('# comment\n*.log\n')).toBe(`# comment\n*.log\n${GIT_EXCLUDE_LINE}\n`)
  })

  it('adds a newline first when the file does not end with one', () => {
    expect(excludeWith('*.log')).toBe(`*.log\n${GIT_EXCLUDE_LINE}\n`)
  })

  it('does nothing when the folder is already excluded', () => {
    // Writing every launch would rewrite a file in someone's repository for
    // no reason, and a growing list of identical lines is its own bug.
    expect(excludeWith(`${GIT_EXCLUDE_LINE}\n`)).toBeUndefined()
    expect(excludeWith('.locust\n')).toBeUndefined()
    expect(excludeWith('*.log\n/.locust/\n')).toBeUndefined()
  })
})
