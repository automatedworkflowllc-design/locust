import { describe, expect, it } from 'vitest'

import { MAX_FILES_PER_REPLY, parseFileBlocks, stripFileBlocks } from './handover.js'

/**
 * A teammate hands the person a file.
 *
 * Colin, 2026-09-19, with a screenshot of the failure: he asked Yurt to "send
 * me an md of your report" and got back a file path as a sentence. The work
 * was done and the file was on disk; the app had no way for a teammate to say
 * "here it is", so the person was told to go and find it.
 *
 * The parser is the whole security surface of the feature, because the path
 * it returns is joined to the workspace folder and handed to the host's
 * reveal. Everything that could point outside that folder is dropped here.
 */

describe('reading a handover block', () => {
  it('reads one file and its note', () => {
    const files = parseFileBlocks('Done.\n<locust-file>\ndocs/report.md :: the rollup you asked for\n</locust-file>')
    expect(files).toEqual([{ path: 'docs/report.md', note: 'the rollup you asked for' }])
  })

  it('reads several, in the order they were written, and the note is optional', () => {
    const files = parseFileBlocks('<locust-file>\na.md\nb.md :: second\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['a.md', 'b.md'])
    expect(files[0]?.note).toBeUndefined()
    expect(files[1]?.note).toBe('second')
  })

  it('finds no files in a reply that has none', () => {
    expect(parseFileBlocks('I wrote docs/report.md for you.')).toEqual([])
  })

  it('takes a model writing the list as bullets', () => {
    // Not a spelling the briefing asks for, and exactly the one a model
    // reaches for when it is listing things. Costs nothing to accept.
    const files = parseFileBlocks('<locust-file>\n- docs/a.md :: one\n* docs/b.md\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['docs/a.md', 'docs/b.md'])
  })

  it('writes one spelling of a path, whichever the model used', () => {
    const files = parseFileBlocks('<locust-file>\ndocs\\sub\\report.md\n./notes.md\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['docs/sub/report.md', 'notes.md'])
  })

  it('draws one button for a file named twice', () => {
    const files = parseFileBlocks('<locust-file>\ndocs/a.md :: the report\ndocs/a.md :: also the report\n</locust-file>')
    expect(files).toHaveLength(1)
  })
})

describe('paths this app will not point at', () => {
  const dropped = (path: string): number => parseFileBlocks(`<locust-file>\n${path}\n</locust-file>`).length

  it('leaves a path that climbs out of the folder to the host, which knows the folders Locust works in (0.516)', () => {
    // A teammate in one folder handed a report it wrote in another Locust works in. Dropped
    // here, it learned to copy files into its own folder instead. The host's reveal, preview
    // and copy each check the path against the folders it knows (reveal-file.ts), so a `..`
    // path anywhere else is still refused -- there, with its reason, when pressed.
    expect(dropped('../Documents/repo/docs/report.md')).toBe(1)
    expect(dropped('docs/../../other/report.md')).toBe(1)
    expect(dropped('..rc')).toBe(1)
  })

  it('drops an absolute path, in every spelling this machine has', () => {
    expect(dropped('/etc/passwd')).toBe(0)
    expect(dropped('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(0)
    expect(dropped('\\\\server\\share\\file.txt')).toBe(0)
  })

  it('drops a path carrying a control character', () => {
    expect(dropped(`docs/report${String.fromCharCode(0)}.md`)).toBe(0)
    expect(dropped(`docs/report${String.fromCharCode(27)}[2K.md`)).toBe(0)
  })

  it('drops an empty line rather than drawing a button to nothing', () => {
    expect(parseFileBlocks('<locust-file>\n\n\n</locust-file>')).toEqual([])
  })

  it('stops at four files', () => {
    const lines = Array.from({ length: 9 }, (_, index) => `docs/file-${String(index)}.md`).join('\n')
    expect(parseFileBlocks(`<locust-file>\n${lines}\n</locust-file>`)).toHaveLength(MAX_FILES_PER_REPLY)
  })

  it('bounds a note, because it is a caption on a button', () => {
    const note = 'x'.repeat(400)
    const [file] = parseFileBlocks(`<locust-file>\ndocs/a.md :: ${note}\n</locust-file>`)
    expect(file?.note?.length).toBeLessThanOrEqual(120)
    expect(file?.note?.endsWith('…')).toBe(true)
  })
})

describe('what the person reads', () => {
  it('shows the answer, not the protocol', () => {
    const said = 'Here is the rollup.\n\n<locust-file>\ndocs/report.md :: the rollup\n</locust-file>'
    expect(stripFileBlocks(said)).toBe('Here is the rollup.')
    expect(stripFileBlocks(said)).not.toContain('locust-file')
  })

  it('leaves a reply with no block exactly as it was', () => {
    expect(stripFileBlocks('Nothing to hand over.')).toBe('Nothing to hand over.')
  })
})
