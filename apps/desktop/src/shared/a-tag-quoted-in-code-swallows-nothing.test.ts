import { describe, expect, it } from 'vitest'

import { stripDecisionBlocks } from './decision.js'
import { parseFileBlocks, refusedFileLines, stripFileBlocks } from './handover.js'
import { parseShareBlocks, stripShareBlocks } from './peer-share.js'
import { blocksOutsideCode } from './protocolTags.js'

/*
 * Colin, 2026-09-30, a reply drawn as "Yes. I ended with a `" -- "bug". The
 * ledger held the whole of it, below: a tag named in backticks, then the real
 * block. Every stripper deleted from the named tag to the real block's close,
 * and the parser never saw the real block at all (0.512).
 */
const GHOST = 'Yes. I ended with a `<locust-file>` block for the completed Markdown report:\n\n`../Documents/Codex/locust-ship-wt/docs/BETA-REVIEW-2026-09-30-0509-sol-long.md`\n\nIf no file button appeared, report that Locust did not render the handoff block. The path goes outside `.claude` using `../`, which may be relevant.\n\n<locust-file>\n../Documents/Codex/locust-ship-wt/docs/BETA-REVIEW-2026-09-30-0509-sol-long.md :: Completed 0.509 workflow review with evidence\n</locust-file>'

describe('a tag quoted in code swallows nothing', () => {
  it('keeps every word of the reply, and takes off only the real block', () => {
    const shown = stripFileBlocks(GHOST)
    expect(shown).toContain('If no file button appeared, report that Locust did not render the handoff block.')
    expect(shown).toContain('which may be relevant.')
    expect(shown).not.toContain('</locust-file>')
    expect(shown.startsWith('Yes. I ended with a `<locust-file>` block')).toBe(true)
  })

  it('finds the real block after a quoted one', () => {
    expect(blocksOutsideCode(GHOST, /<locust-file\s*>([\s\S]*?)<\/locust-file>/g)).toHaveLength(1)
    const inside = 'See `<locust-file>`.\n\n<locust-file>\ndocs/report.md :: the report\n</locust-file>'
    expect(parseFileBlocks(inside)).toEqual([{ path: 'docs/report.md', note: 'the report' }])
  })

  it('draws Ghost\'s file, outside its folder, and leaves the folder rule to the host (0.516)', () => {
    expect(parseFileBlocks(GHOST)).toEqual([{ path: '../Documents/Codex/locust-ship-wt/docs/BETA-REVIEW-2026-09-30-0509-sol-long.md', note: 'Completed 0.509 workflow review with evidence' }])
    expect(refusedFileLines(GHOST)).toEqual([])
  })

  it('says a handed file it will not draw, rather than nothing', () => {
    expect(refusedFileLines('<locust-file>\nC:\\Users\\x\\report.md\n</locust-file>')).toEqual([{ path: 'C:/Users/x/report.md', why: 'it is not a path inside a folder Locust works in' }])
    expect(refusedFileLines('<locust-file>\ndocs/report.md\n</locust-file>')).toEqual([])
    expect(refusedFileLines('<locust-file>\npath/relative/to/the/folder.md\n</locust-file>')).toEqual([])
  })

  it('the same for a share and an ask', () => {
    const share = 'I used `<locust-share to="Reviewer">` once.\n\n<locust-share to="Reviewer">\nThe tests pass.\n</locust-share>\n\nDone.'
    expect(parseShareBlocks(share).map((block) => block.text)).toEqual(['The tests pass.'])
    expect(stripShareBlocks(share)).toContain('Done.')
    expect(stripShareBlocks(share)).toContain('I used `<locust-share to="Reviewer">` once.')
    const ask = 'The form is `<locust-ask>`.\n\nMore words here.\n\n<locust-ask>\nWhich storage?\n- JSON :: simple\n- CSV :: spreadsheet\n</locust-ask>'
    expect(stripDecisionBlocks(ask)).toContain('More words here.')
  })
})
