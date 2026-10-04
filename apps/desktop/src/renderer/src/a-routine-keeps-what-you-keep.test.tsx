import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRoutine, PublicTeammate } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { RoutineChanges } from './components/RoutineChanges.js'
import { RoutineDialog } from './components/RoutineDialog.js'

/**
 * A ROUTINE KEEPS ONLY WHAT YOU KEEP (0.533). A routine that may change files
 * can work in a copy; its last run's changes wait on its card for Keep or
 * Discard, and the dialog says, before saving, that nothing lands until then.
 */
const cedar = { teammateId: 'tm_cedar', name: 'Cedar', hue: 'lime', role: 'Custom', createdAt: '2026-10-01T00:00:00.000Z', avatar: seedAvatar('tm_cedar') } as unknown as PublicTeammate
const dialog = (modeName: string, modeReadsOnly: boolean, initialInCopy: boolean) =>
  renderToStaticMarkup(
    <RoutineDialog
      teammate={cedar}
      initialName="Inbox receipt"
      initialSteps={['Write a receipt for the file.']}
      initialSchedule={{ kind: 'files', folder: 'inbox' }}
      truncated={false}
      routeLabel="OpenCode / Fledge Alpha Free"
      editing
      modeName={modeName}
      modeReadsOnly={modeReadsOnly}
      initialInCopy={initialInCopy}
      busy={false}
      error={undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
    />
  )

describe('where a routine works', () => {
  it('offers the copy only to a routine that may change files', () => {
    expect(dialog('Edit', false, false)).toContain('aria-label="Where it works"')
    expect(dialog('Ask', true, false)).not.toContain('aria-label="Where it works"')
  })

  it('in a copy, every sentence says nothing lands until you keep it', () => {
    const html = dialog('Edit', false, true)
    expect(html).toMatch(/aria-checked="true"[^>]*>In a copy, you keep</)
    expect(html).toContain('It changes files in a copy of the folder. When a run finishes, its changes wait under Routines')
    expect(html).toContain('It may change files in its copy; nothing lands in the folder until you keep it.')
    expect(html).not.toContain('lands in the folder straight away')
  })

  it('in the folder, it says the change lands straight away', () => {
    const html = dialog('Edit', false, false)
    expect(html).toMatch(/aria-checked="true"[^>]*>In the folder</)
    expect(html).toContain('lands in the folder straight away')
  })
})

describe('a standing goal in the dialog (0.534)', () => {
  const withGoal = (checkCommand: string | undefined, initialGoalTries: number | undefined) =>
    renderToStaticMarkup(
      <RoutineDialog
        teammate={cedar}
        initialName="Green tests"
        initialSteps={['Fix the cart total.']}
        initialSchedule={undefined}
        truncated={false}
        routeLabel="Codex / GPT-6-Luna"
        editing
        modeName="Edit"
        modeReadsOnly={false}
        {...(checkCommand === undefined ? {} : { checkCommand })}
        {...(initialGoalTries === undefined ? {} : { initialGoalTries })}
        busy={false}
        error={undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
      />
    )

  it('with no check command, says where to set one and cannot be chosen', () => {
    const html = withGoal(undefined, undefined)
    expect(html).toContain('This folder has no check command yet. Set one in Settings &gt; Project folder')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Keep going until the check passes</)
  })

  it('chosen, it names the command, the fixes it may make, and that each is one more turn', () => {
    const html = withGoal('npm test', 3)
    expect(html).toMatch(/aria-checked="true"[^>]*>Keep going until the check passes</)
    expect(html).toContain('When its steps are done it runs `npm test`. While that fails, it is asked to fix what it says, up to 3 times; then it stops and says what still fails. Each fix is one more turn.')
  })
})

describe('the changes waiting on a routine\'s card', () => {
  const routine = {
    routineId: 'rt_inbox', name: 'Inbox receipt', teammateId: 'tm_cedar',
    route: { runtime: 'opencode', model: 'opencode/fledge-alpha-free', mode: 'accept-edits' },
    steps: ['Write a receipt.'], learnedFrom: [], createdAt: '2026-10-01T00:00:00.000Z', runs: 1, inCopy: true,
    staged: { attemptId: 'a1', finishedAt: '2026-10-01T10:00:00.000Z', folder: 'C:/work', changed: ['receipts/a.md', 'receipts/b.md', 'notes.md', 'x.md', 'y.md'], deleted: ['old.md'] }
  } as unknown as PublicRoutine

  it('names what changed, says nothing has reached the folder, and offers Keep, Discard and the copy', () => {
    const html = renderToStaticMarkup(<RoutineChanges routine={routine} onSettle={() => undefined} />)
    expect(html).toContain('its last run changed 6 files in its copy')
    expect(html).toContain('receipts/a.md, receipts/b.md, notes.md, x.md and 2 more')
    expect(html).toContain('Nothing has reached the folder.')
    expect(html).toMatch(/>Keep</)
    expect(html).toMatch(/>Discard</)
    expect(html).toMatch(/>Open the copy</)
  })

  it('draws nothing when nothing waits', () => {
    const { staged: _staged, ...rest } = routine
    expect(renderToStaticMarkup(<RoutineChanges routine={rest as PublicRoutine} onSettle={() => undefined} />)).toBe('')
  })
})
