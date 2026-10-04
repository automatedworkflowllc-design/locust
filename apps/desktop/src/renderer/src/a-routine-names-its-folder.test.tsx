import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoutine } from '../../shared/ipc.js'
import { AutomationsScreen } from './components/AutomationsScreen.js'
import DIALOG from './components/RoutineDialog.tsx?raw'

/*
 * Sol's long pass on 0.509: a routine's card and editor showed its time, model
 * and mode, and not the folder a schedule runs it in -- in a profile that had
 * just moved between folders for Cloud (0.512).
 */
const routine = {
  routineId: 'rt_1',
  name: 'Run the tests',
  teammateId: 'tm_builder',
  route: { runtime: 'opencode', model: 'opencode/free', mode: 'accept-edits' },
  steps: ['npm test'],
  learnedFrom: [],
  createdAt: '2026-09-30T21:00:00.000Z',
  runs: 0,
  schedule: { kind: 'daily', at: '09:00' },
  workspaceId: 'ws_habits'
} as unknown as PublicRoutine

const card = (folders: readonly { id: string; path: string; name: string }[]): string =>
  renderToStaticMarkup(
    <AutomationsScreen
      routines={[routine]}
      teammates={[]}
      routineStepByTeammate={{}}
      onRunRoutine={() => undefined}
      onEditRoutine={() => undefined}
      onRemoveRoutine={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
      folders={folders}
    />
  )

describe('a routine names the folder it runs in', () => {
  it('on its card, with the whole path on hover', () => {
    const html = card([{ id: 'ws_habits', path: 'C:\\Users\\x\\sol-long-project', name: 'sol-long-project' }])
    expect(html).toContain(' · in sol-long-project')
    expect(html).toContain('title="C:\\Users\\x\\sol-long-project"')
  })

  it('and says nothing it does not know', () => {
    expect(card([])).not.toContain(' · in ')
  })

  it('and in its editor, beside when it runs', () => {
    expect(DIALOG).toContain('{` On a schedule it runs in ${folder.name}.`}')
  })
})
