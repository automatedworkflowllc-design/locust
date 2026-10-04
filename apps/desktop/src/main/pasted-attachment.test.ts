import { describe, expect, it } from 'vitest'

import { attachmentDestination, ATTACHMENT_DIR } from './attach-outside.js'

/**
 * A pasted screenshot has no path, so the host names it.
 *
 * Colin, 2026-09-10: "lets add the ability to ctrl+v a file or photo into the
 * chat." The clipboard holds a bitmap rather than a file, so there is nothing
 * for the picker's path-based route to take -- the renderer sends bytes and a
 * SUGGESTED name.
 *
 * Which means, for the first time, a name reaching this function came from the
 * renderer rather than from an OS file dialog. The function's own comment
 * already anticipated exactly that: "a function that BUILDS A WRITE PATH must
 * not depend on its caller to be safe". This is the control that says so is
 * still true now that the caller has changed.
 */
describe('a name that arrived from the clipboard', () => {
  it('lands inside the one folder Locust owns', () => {
    expect(attachmentDestination('shot.png', new Set())).toBe(`${ATTACHMENT_DIR}/shot.png`)
  })

  it('cannot climb out of it, however it is spelled', () => {
    /*
     * The invariant is CONTAINMENT, not refusal.
     *
     * Some of these throw and some reduce to a plain name -- `basename` turns
     * `/etc/passwd` into `passwd`, which then lands in the attachments folder
     * like any other file, and that is correct. What must never happen is a
     * destination that leaves the folder, so that is what is asserted.
     *
     * The first version of this test demanded a throw for every one of them,
     * which was a claim about the implementation rather than about safety,
     * and it failed on a name that was already perfectly contained.
     */
    const SEP = String.fromCharCode(92)
    for (const hostile of [
      '..',
      '.',
      '',
      `..${SEP}..${SEP}settings.json`,
      '../../settings.json',
      `C:${SEP}Windows${SEP}system32${SEP}drivers${SEP}etc${SEP}hosts`,
      '/etc/passwd',
      // On Windows this names an alternate data stream rather than a file.
      'notes.txt:stream',
      `${SEP}${SEP}server${SEP}share${SEP}thing.txt`
    ]) {
      let destination: string | undefined
      try {
        destination = attachmentDestination(hostile, new Set())
      } catch {
        // Refused outright, which is also fine.
        continue
      }
      expect(destination.startsWith(`${ATTACHMENT_DIR}/`), `${hostile} -> ${destination}`).toBe(true)
      expect(destination.split('/').includes('..'), hostile).toBe(false)
      expect(destination.split('/'), hostile).toHaveLength(ATTACHMENT_DIR.split('/').length + 1)
    }
  })

  it('never overwrites something already attached', () => {
    // Two screenshots pasted in a row are both called image.png.
    const taken = new Set(['image.png', 'image-2.png'])
    expect(attachmentDestination('image.png', taken)).toBe(`${ATTACHMENT_DIR}/image-3.png`)
  })

  it('keeps the extension where there is one, and copes where there is not', () => {
    expect(attachmentDestination('report.tar.gz', new Set(['report.tar.gz']))).toBe(
      `${ATTACHMENT_DIR}/report.tar-2.gz`
    )
    expect(attachmentDestination('LICENSE', new Set(['LICENSE']))).toBe(`${ATTACHMENT_DIR}/LICENSE-2`)
  })
})
