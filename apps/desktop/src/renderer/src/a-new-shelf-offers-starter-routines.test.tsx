/** 0.615, the PRD's R16: "Ten starter routines shipped as files, 'Start from a template'". */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoutine, PublicTeammate, RoutineImportPreview, RoutineTemplateInfo } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { AutomationsScreen } from './components/AutomationsScreen.js'
import { RoutineImportDialog } from './components/RoutineFileDialog.js'
import { RoutineTemplateDialog, templateMeta, templatesLine } from './components/RoutineTemplates.js'
import { NOTHING_TO_SAVE_YET } from './savableConversations.js'

const route = { runtime: 'opencode', model: 'free', mode: 'ask' } as const
const mate: PublicTeammate = { teammateId: 'tm_one', name: 'One', role: 'Custom', hue: 'lime', avatar: seedAvatar('tm_one'), createdAt: '2026-10-04T00:00:00Z', route }
const routine: PublicRoutine = { routineId: 'rt_one', name: 'Notes', teammateId: 'tm_one', route, steps: ['Read the notes.'], learnedFrom: [], createdAt: '2026-10-04T00:00:00Z', runs: 0 }
const templates: readonly RoutineTemplateInfo[] = [
  { id: 'explain-this-project', name: 'Explain this project', summary: 'What this folder is, for someone new.', steps: 1, asks: [] },
  { id: 'challenge-an-idea', name: 'Challenge an idea before building it', summary: 'An architect, then a checker.', steps: 4, asks: ['The idea'] },
  { id: 'draft-a-reply', name: 'Draft a reply', summary: 'A short reply to a message.', steps: 1, asks: ['The message', 'Tone', 'What it should say'] },
  { id: 'review-a-file', name: 'Review a file', summary: 'A careful review of one file.', steps: 1, asks: ['Which file?'] }
]
const nothing = (): void => undefined
const shelf = (over: Record<string, unknown> = {}): string => renderToStaticMarkup(
  <AutomationsScreen routines={[]} teammates={[mate]} routineStepByTeammate={{}} onRunRoutine={nothing} onEditRoutine={nothing}
    onRemoveRoutine={nothing} notice={undefined} onDismissNotice={nothing} missions={[]} onSaveRoutine={nothing} onNewRoutine={nothing} {...over} />
)

describe('an empty Routines screen lists the starter routines', () => {
  it('lists each one as a button with its name, its size and what it does, in place of the sentence', () => {
    const html = shelf({ templates, onUseTemplate: nothing })
    for (const template of templates) {
      expect(html).toContain(template.name)
      expect(html).toContain(template.summary)
    }
    expect(html.match(/<button type="button" class="lc-templates__row"/g)).toHaveLength(templates.length)
    expect(html).toContain('Start from a template, or press New routine to write your own.')
    expect(html).not.toContain(NOTHING_TO_SAVE_YET)
    // Its questions, by label, where a pointer rests.
    expect(html).toContain('title="It asks: The message · Tone · What it should say"')
  })

  it('offers them after the finished conversations, not instead of them', () => {
    const html = shelf({ templates, onUseTemplate: nothing, missions: [{ missionId: 'm1', title: 'Friday release checks', phase: 'completed', turns: 4, lastAt: '2026-10-04T04:00:00.000Z' }] })
    expect(html.indexOf('Friday release checks')).toBeLessThan(html.indexOf('Or start from a template.'))
  })

  it('keeps the old sentence when there are none to offer', () => {
    expect(shelf()).toContain(NOTHING_TO_SAVE_YET)
    expect(shelf({ templates: [], onUseTemplate: nothing })).toContain(NOTHING_TO_SAVE_YET)
    expect(shelf({ templates })).toContain(NOTHING_TO_SAVE_YET)
  })
})

describe('a shelf with routines keeps them a row away', () => {
  it('ends the list with Start from a template, naming the first few', () => {
    const html = shelf({ routines: [routine], templates, onUseTemplate: nothing, onBrowseTemplates: nothing })
    expect(html).toContain('Start from a template')
    expect(html).toContain('Explain this project, Challenge an idea before building it, Draft a reply and 1 more')
    // Not the whole list: that is the empty screen's.
    expect(html).not.toContain('lc-templates__row')
    expect(shelf({ routines: [routine], templates: [], onBrowseTemplates: nothing })).not.toContain('Start from a template')
  })

  it('opens the list in a dialog that says nothing is added yet', () => {
    const html = renderToStaticMarkup(<RoutineTemplateDialog templates={templates} onUse={nothing} onCancel={nothing} />)
    expect(html).toContain('aria-label="Start from a template"')
    expect(html).toContain('Nothing is added until you give it to a teammate.')
    expect(html.match(/lc-templates__row/g)).toHaveLength(templates.length)
  })
})

describe('the words', () => {
  it('says how big each one is and how much it asks', () => {
    expect(templateMeta(templates[0]!)).toBe('1 step · no questions')
    expect(templateMeta(templates[1]!)).toBe('4 steps · 1 question')
    expect(templateMeta(templates[2]!)).toBe('1 step · 3 questions')
    expect(templatesLine(templates.slice(0, 2))).toBe('Explain this project, Challenge an idea before building it')
  })

  it('previews a template as added, not imported, with no connector list it does not need', () => {
    const preview: RoutineImportPreview = { token: 't', name: 'Review a file', steps: ['Read {{file}}.'], inputs: [{ key: 'file', label: 'Which file?', kind: 'text', required: true }], handOffRoles: [undefined], connectors: [] }
    const html = renderToStaticMarkup(<RoutineImportDialog preview={preview} fromTemplate team={[mate]} onImport={async () => undefined} onCancel={nothing} />)
    expect(html).toContain('aria-label="Add a starter routine"')
    expect(html).toContain('>Review a file</span>')
    expect(html).toMatch(/disabled=""[^>]*>Add routine<\/button>/)
    expect(html).toContain('runs nothing until you press Run')
    expect(html).not.toContain('Connectors it needs')
    expect(html).not.toContain('Import')
    // A file keeps its own words.
    const file = renderToStaticMarkup(<RoutineImportDialog preview={preview} team={[mate]} onImport={async () => undefined} onCancel={nothing} />)
    expect(file).toContain('Import Review a file')
    expect(file).toContain('Connectors it needs')
  })
})
