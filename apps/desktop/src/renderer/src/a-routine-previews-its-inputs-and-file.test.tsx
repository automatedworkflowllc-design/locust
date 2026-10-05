/** W7: "Running by hand asks for the values in a small dialog (defaults filled)" and "Import previews". */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PublicRoutine, PublicTeammate, RoutineImportPreview } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { RoutineRunDialog } from './components/RoutineInputs.js'
import { RoutineImportDialog, RoutineExportDialog } from './components/RoutineFileDialog.js'
import { RoutineDialog } from './components/RoutineDialog.js'
import { AutomationsScreen } from './components/AutomationsScreen.js'

const routine: PublicRoutine = { routineId: 'rt_one', name: 'Notes', teammateId: 'tm_one', route: { runtime: 'opencode', model: 'free', mode: 'ask' },
  steps: ['Read {{topic}} in {{folder}}'], learnedFrom: [], createdAt: '2026-10-03T00:00:00Z', runs: 0,
  inputs: [{ key: 'topic', label: 'Topic', kind: 'text', required: true, default: 'Daily notes' },
    { key: 'folder', label: 'Folder', kind: 'folder', required: true },
    { key: 'tone', label: 'Tone', kind: 'choice', required: false, choices: ['Brief', 'Detailed'], default: 'Brief' },
    { key: 'note', label: 'Note', kind: 'long-text', required: false, default: 'two\nlines' }] }
const mate: PublicTeammate = { teammateId: 'tm_one', name: 'One', role: 'Custom', hue: 'lime', avatar: seedAvatar('tm_one'), createdAt: routine.createdAt, route: routine.route }
const nothing = (): void => undefined

describe('routine inputs and files are reviewable before work starts', () => {
  it('fills defaults, draws each kind, and a folder has a picker with no typed path field', () => {
    const html = renderToStaticMarkup(<RoutineRunDialog routine={routine} onRun={async () => undefined} onCancel={nothing} />)
    expect(html).toContain('aria-label="Run routine"')
    expect(html).toContain('value="Daily notes"')
    expect(html).toContain('selected="">Brief')
    expect(html).toContain('two\nlines</textarea>')
    expect(html).toContain('Choose Folder')
    expect(html).not.toContain('aria-label="Folder"')
    expect(html).toMatch(/disabled=""[^>]*>Run routine<\/button>/)
  })
  it('the routine editor shows declarations and refuses a step with an undeclared input', () => {
    const html = renderToStaticMarkup(<RoutineDialog teammate={mate} initialName="Notes" initialSteps={['Read {{missing}}']} initialInputs={routine.inputs}
      initialSchedule={undefined} truncated={false} routeLabel="OpenCode / Free" busy={false} error={undefined} onSave={nothing} onCancel={nothing} />)
    expect(html).toContain('Input 1 key')
    expect(html).toContain('not declared as an input')
    expect(html).toContain('Add input')
    expect(html).toMatch(/disabled=""[^>]*>Save routine<\/button>/)
  })
  it('the import preview names steps, inputs, choices, source roles and present/missing connectors', () => {
    const preview: RoutineImportPreview = { token: 'token', name: 'Notes', steps: routine.steps, inputs: routine.inputs!, handOffRoles: ['Finance Bro'], handOffChecks: [false], runtime: 'opencode', connectors: [{ name: 'available', present: true }, { name: 'needed', present: false }] }
    const html = renderToStaticMarkup(<RoutineImportDialog preview={preview} team={[mate]} onImport={async () => undefined} onCancel={nothing} />)
    for (const saying of ['Read {{topic}} in {{folder}}', 'Daily notes', 'Brief, Detailed', 'Finance Bro', 'available · present', 'needed · missing', 'Give routine to', 'with no schedule, and runs nothing']) expect(html).toContain(saying)
    expect(html).toMatch(/disabled=""[^>]*>Import routine<\/button>/)
  })
  it('export paths are shown with a conversion offer, and the routines screen has file actions', () => {
    const html = renderToStaticMarkup(<RoutineExportDialog flagged={[{ step: 1, path: 'C:\\private\\folder' }]} onExport={async () => undefined} onCancel={nothing} />)
    expect(html).toContain('C:\\private\\folder')
    expect(html).toContain('Make paths inputs')
    expect(html).toContain('Keep paths')
    const shelf = renderToStaticMarkup(<AutomationsScreen routines={[routine]} teammates={[mate]} routineStepByTeammate={{}} onRunRoutine={nothing} onEditRoutine={nothing} onRemoveRoutine={nothing} notice={undefined} onDismissNotice={nothing} onNewRoutine={nothing} onImportRoutine={nothing} onExportRoutine={nothing} />)
    expect(shelf).toContain('Import routine')
    expect(shelf).toContain('aria-label="Export Notes"')
  })
})
