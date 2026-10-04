import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { RoutineDialog } from './components/RoutineDialog.js'

/**
 * A ROUTINE SAYS WHAT IT MAY DO, AND IT IS TRUE (0.530). Sol's 0.528 pass: a
 * file routine's dialog said "always Edit" at the top and "It reads the file
 * and changes nothing, as every routine runs in Ask" under the trigger, and
 * the run wrote receipts into the folder at once. Now the person picks
 * "Only read" or "Change files", and every sentence follows that choice.
 */
const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', createdAt: '2026-09-01T00:00:00.000Z', avatar: seedAvatar('tm_wren') } as unknown as PublicTeammate
const dialog = (modeName: string, modeReadsOnly: boolean) =>
  renderToStaticMarkup(
    <RoutineDialog
      teammate={wren}
      initialName="Inbox receipt"
      initialSteps={['Write a receipt for the file.']}
      initialSchedule={{ kind: 'files', folder: 'inbox' }}
      truncated={false}
      routeLabel="OpenCode / Fledge Alpha Free"
      editing
      modeName={modeName}
      modeReadsOnly={modeReadsOnly}
      busy={false}
      error={undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
    />
  )

describe('a routine says what it may do', () => {
  it('in Edit: "Change files" is chosen, and the file trigger says what lands in the folder', () => {
    const html = dialog('Edit', false)
    expect(html).toContain('What a run may do')
    expect(html).toMatch(/aria-checked="true"[^>]*>Change files</)
    expect(html).toContain('What a run changes lands in the folder straight away')
    expect(html).toContain('It may change files, and what it changes lands in the folder straight away.')
    expect(html).not.toContain('changes nothing, as every routine runs in Ask')
    expect(html).toContain('in Edit.')
  })

  it('in Ask: "Only read" is chosen, and the trigger says it changes nothing', () => {
    const html = dialog('Ask', true)
    expect(html).toMatch(/aria-checked="true"[^>]*>Only read</)
    expect(html).toContain('It reads the file and changes nothing.')
    expect(html).toContain('nothing in the folder changes')
    expect(html).not.toContain('It may change files')
  })
})
