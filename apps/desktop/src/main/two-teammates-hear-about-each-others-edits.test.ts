import { describe, expect, it } from 'vitest'

import { composeRuntimePrompt } from './workroom-briefing.js'
import { createRecentEdits, OVERLAP_WINDOW_MS } from './recent-edits.js'

/**
 * A2.9: THE OVERLAP NOTE. Two teammates in one folder who each changed the
 * same file are told about each other in their next brief, so the second
 * edit is made knowing about the first.
 */
const FOLDER = 'C:/work/app'
const T0 = new Date('2026-09-24T12:00:00.000Z')
const later = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000)

describe('the overlap note', () => {
  it('names the file another teammate changed that you changed too, and who, and when', () => {
    const edits = createRecentEdits()
    edits.record({ folder: FOLDER, teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts', 'src/only-wren.ts'], at: T0 })
    edits.record({ folder: FOLDER, teammateId: 'tm_ash', name: 'Ash', paths: ['src/app.ts', 'README.md'], at: later(20) })
    const note = edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: later(60) })
    expect(note).toContain('- Ash changed src/app.ts (last 40 minutes ago).')
    expect(note).not.toContain('README.md')
    expect(note).not.toContain('only-wren')
    // And the other way round: Ash hears about Wren.
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_ash', now: later(60) })).toContain('- Wren changed src/app.ts')
  })

  it('says nothing when nobody else touched your files', () => {
    const edits = createRecentEdits()
    edits.record({ folder: FOLDER, teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts'], at: T0 })
    edits.record({ folder: FOLDER, teammateId: 'tm_ash', name: 'Ash', paths: ['README.md'], at: T0 })
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: later(5) })).toBeUndefined()
    // Nor to a teammate who changed nothing here.
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_new', now: later(5) })).toBeUndefined()
  })

  it('is about one folder: the same path in another folder is another file', () => {
    const edits = createRecentEdits()
    // A real overlap in the other folder, recorded first, must not leak into this one.
    edits.record({ folder: 'C:/work/other', teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts'], at: T0 })
    edits.record({ folder: 'C:/work/other', teammateId: 'tm_ash', name: 'Ash', paths: ['src/app.ts'], at: T0 })
    edits.record({ folder: FOLDER, teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts'], at: T0 })
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: later(5) })).toBeUndefined()
    expect(edits.overlapFor({ folder: 'C:/work/other', teammateId: 'tm_wren', now: later(5) })).toContain('Ash')
  })

  it('treats one folder as one, however Windows spells it', () => {
    if (process.platform !== 'win32') return
    const edits = createRecentEdits()
    edits.record({ folder: 'C:\\Work\\App\\', teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts'], at: T0 })
    edits.record({ folder: 'c:/work/app', teammateId: 'tm_ash', name: 'Ash', paths: ['src/app.ts'], at: T0 })
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: later(5) })).toContain('Ash')
  })

  it('forgets a change once it is no longer recent', () => {
    const edits = createRecentEdits()
    edits.record({ folder: FOLDER, teammateId: 'tm_wren', name: 'Wren', paths: ['src/app.ts'], at: T0 })
    edits.record({ folder: FOLDER, teammateId: 'tm_ash', name: 'Ash', paths: ['src/app.ts'], at: T0 })
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: new Date(T0.getTime() + OVERLAP_WINDOW_MS + 60_000) })).toBeUndefined()
  })

  it('names eight files per teammate and counts the rest', () => {
    const edits = createRecentEdits()
    const many = Array.from({ length: 11 }, (_, i) => `src/f${String(i)}.ts`)
    edits.record({ folder: FOLDER, teammateId: 'tm_wren', name: 'Wren', paths: many, at: T0 })
    edits.record({ folder: FOLDER, teammateId: 'tm_ash', name: 'Ash', paths: many, at: T0 })
    expect(edits.overlapFor({ folder: FOLDER, teammateId: 'tm_wren', now: later(5) })).toContain(' and 3 more (last')
  })
})

describe('in the brief', () => {
  const PEER = {
    self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
    others: [{ teammateId: 'tm_ash', name: 'Ash', role: 'Docs & QA' }]
  } as unknown as Parameters<typeof composeRuntimePrompt>[0]['peer']

  it('goes right before the person\u2019s words, with what arrived this turn', () => {
    const brief = composeRuntimePrompt({ prompt: 'Tidy app.ts.', peer: PEER, inbound: [], remaining: 0, overlap: 'NOTE: Ash changed src/app.ts.' })
    expect(brief.prompt.indexOf('NOTE: Ash')).toBeLessThan(brief.prompt.indexOf('Tidy app.ts.'))
    expect(brief.prompt.indexOf('NOTE: Ash')).toBeGreaterThan(brief.prompt.indexOf('Ash (Docs & QA)'))
  })
})
