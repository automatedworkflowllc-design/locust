import { describe, expect, it } from 'vitest'

import { backedUpLine, countsLine, folderName, restoreNoticeLine } from './backupWords.js'

const NONE = { teammates: 0, routines: 0, memories: 0, rules: 0, groups: 0, rooms: 0, compares: 0, folders: 0, conversations: 0 }

describe('what a backup holds, in words (0.614)', () => {
  it('names what has something in it, in the person\'s own nouns, one and many', () => {
    expect(countsLine({ ...NONE, teammates: 6, routines: 1, memories: 106, conversations: 186 })).toBe('6 teammates, 1 routine, 106 memories and 186 conversations')
    expect(countsLine({ ...NONE, rules: 1, conversations: 1 })).toBe('1 saved approval and 1 conversation')
    expect(countsLine({ ...NONE, teammates: 1 })).toBe('1 teammate')
    expect(countsLine(NONE)).toBe('nothing yet')
  })

  it('says what a backup did and where, by the folder\'s own name', () => {
    expect(backedUpLine({ folder: 'C:\\Users\\me\\Backups\\Locust backup 2026-10-04 2015', counts: { ...NONE, teammates: 2, conversations: 3 } }, '1.2 MB'))
      .toBe('Backed up 2 teammates and 3 conversations (1.2 MB) to "Locust backup 2026-10-04 2015".')
    expect(folderName('D:/x/y/')).toBe('y')
  })

  it('says what a restore did after the restart, or that it changed nothing', () => {
    expect(restoreNoticeLine({ ok: true, folder: 'C:\\b\\Locust backup 2026-10-04 2015', at: '', aside: 'C:\\p\\before-restore-20261004-201500', counts: { ...NONE, teammates: 2 } }))
      .toBe('Restored 2 teammates from "Locust backup 2026-10-04 2015". What was here before is kept in "before-restore-20261004-201500", in Locust\'s profile folder.')
    expect(restoreNoticeLine({ ok: false, folder: 'C:\\b', at: '', reason: 'The backup is missing teammates.json.' }))
      .toBe('The restore was not applied, and nothing here changed. The backup is missing teammates.json.')
  })
})
