import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PublicRoutine, PublicTeammate } from '../../shared/ipc.js'
import { RoutineRecovery } from './components/RoutineRecovery.js'
import { AutomationsScreen } from './components/AutomationsScreen.js'
import { TeammatesScreen } from './components/Screens.js'
import { routineRunSummary, routineScheduleSummary } from './routines.js'
import { seedAvatar } from '../../shared/avatar.js'

const routine: PublicRoutine = {
  routineId: 'rt_one', name: 'Release', teammateId: 'tm_one', route: { runtime: 'codex', model: 'account-default', mode: 'ask' },
  steps: ['Open PR', 'Summarise', 'Report'], learnedFrom: [], createdAt: '2026-09-01T00:00:00.000Z', runs: 0,
  schedule: { kind: 'every', hours: 6 },
  execution: { attemptId: 'attempt_one', status: 'held', step: 2, of: 3, workspaceId: 'ws_test',
    startedAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
    steps: ['Open PR', 'Summarise', 'Report'], route: { runtime: 'codex', model: 'account-default', mode: 'ask' },
    missionId: 'mission_two', runId: 'run_two', reason: 'The dispatch outcome is uncertain.', canContinue: false }
}
const teammate: PublicTeammate = { teammateId: 'tm_one', name: 'One', role: 'Custom', hue: 'lime', avatar: seedAvatar('tm_one'), route: routine.route, createdAt: routine.createdAt }
const nothing = (): void => undefined

describe('recovery where a person looks for routines', () => {
  it('both routine surfaces render a held attempt from persisted data, with no notification event', () => {
    const persisted = JSON.parse(JSON.stringify(routine)) as PublicRoutine
    const automations = renderToStaticMarkup(<AutomationsScreen routines={[persisted]} teammates={[teammate]}
      routineStepByTeammate={{}} onRunRoutine={nothing} onEditRoutine={nothing} onRemoveRoutine={nothing}
      notice={undefined} onDismissNotice={nothing}  />)
    const team = renderToStaticMarkup(<TeammatesScreen teammates={[teammate]} missions={[]} missionOwners={{}} viewByTeammate={{}}
      titleOf={() => ''} onOpenMission={nothing} onNewTeammate={nothing} onEdit={nothing} onRemove={nothing} onMessage={nothing}
      routines={[persisted]} routineStepByTeammate={{}} onRunRoutine={nothing} onEditRoutine={nothing} onRemoveRoutine={nothing} />)
    for (const html of [automations, team]) {
      expect(html).toContain('Waiting for your review')
      expect(html).toContain('Step 2 of 3')
      expect(html).toContain('Attempt started')
      expect(html).toContain('mission_two')
      expect(html).toContain('no automatic retry')
      expect(html).not.toContain('not run yet')
      expect(html).not.toContain('due now')
      expect(html).toMatch(/disabled=""[^>]*>Run<\/button>/)
    }
  })

  it('review acknowledgement is unchecked and both decisions start disabled, even for a confirmed step', () => {
    const html = renderToStaticMarkup(<RoutineRecovery routine={{ ...routine, execution: { ...routine.execution!, canContinue: true } }} recover={async () => ({ ok: true })} />)
    expect(html).toContain('I reviewed the saved mission and external work')
    expect(html).not.toContain('checked=""')
    expect(html).toMatch(/disabled="">Continue remaining steps/)
    expect(html).toMatch(/disabled="">Abandon attempt and remove schedule/)
    expect(html).toContain('does not stop a runtime or undo work')
    expect(html).toContain('starts again from step 1')
    expect(html).toContain('Open PR')
    expect(html).toContain('codex')
  })

  it('abandonment stays visible after acknowledgement instead of reverting to never ran', () => {
    const abandoned = { ...routine, execution: { ...routine.execution!, status: 'abandoned' as const, reason: 'Abandoned by you; schedule removed.' } }
    const html = renderToStaticMarkup(<RoutineRecovery routine={abandoned} />)
    expect(html).toContain('Attempt abandoned')
    expect(html).toContain('Step 2 of 3')
    expect(html).not.toContain('<button')
    expect(routineRunSummary(abandoned)).toContain('last attempt abandoned')
  })

  it('an unresolved dispatch has the same visible protection; no optimistic next-run promise', () => {
    const dispatching = { ...routine, execution: { ...routine.execution!, status: 'dispatching' as const } }
    expect(renderToStaticMarkup(<RoutineRecovery routine={dispatching} />)).toContain('Waiting for your review')
    expect(routineScheduleSummary(dispatching, new Date('2026-09-08'))).toContain('held for review; no automatic retry')
  })
})
