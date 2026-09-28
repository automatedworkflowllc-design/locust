import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { PublicTeammate } from '../../shared/ipc.js'
import { RoutineDialog } from './components/RoutineDialog.js'
import { routineChain } from './routines.js'

/**
 * A HAND-OFF CHAIN, IN THE EDITOR (0.435): each step says who takes it and
 * whether it checks, when there is anyone to hand it to.
 */
const person = (teammateId: string, name: string): PublicTeammate =>
  ({ teammateId, name, hue: 'blue', avatar: seedAvatar(teammateId), role: 'Code & Migrations', createdAt: '2026-09-28T00:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' } }) as PublicTeammate
const WREN = person('tm_wren', 'Wren')
const ATLAS = person('tm_atlas', 'Atlas')
const SABLE = person('tm_sable', 'Sable')

const dialog = (team: readonly PublicTeammate[], initialHandOffs?: readonly { teammateId?: string; check?: true }[]): string =>
  renderToStaticMarkup(
    <RoutineDialog
      teammate={WREN}
      initialName="Intake to review"
      initialSteps={['Find the bug.', 'Plan the fix.', 'Check the plan.']}
      initialSchedule={undefined}
      team={team}
      {...(initialHandOffs === undefined ? {} : { initialHandOffs })}
      truncated={false}
      routeLabel={undefined}
      busy={false}
      error={undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
    />
  )

describe('the routine editor', () => {
  it('asks who takes each step, and whether it checks, when there is a team', () => {
    const html = dialog([WREN, ATLAS, SABLE], [{}, { teammateId: 'tm_atlas' }, { teammateId: 'tm_sable', check: true }])
    expect(html.match(/aria-label="Who takes step \d"/g)).toHaveLength(3)
    expect(html).toContain('Wren (runs it)')
    // The routine's own teammate is the first choice, not repeated below it.
    expect(html.match(/>Wren</g) ?? []).toHaveLength(0)
    expect(html.match(/Checker: must approve/g)).toHaveLength(3)
    expect(html).toContain('a checker must approve for the run to count as done')
  })

  it('draws no choice for a teammate on their own', () => {
    const html = dialog([WREN])
    expect(html).not.toContain('Who takes step')
    expect(html).not.toContain('Checker')
  })
})

describe('a routine card', () => {
  const routine = { teammateId: 'tm_wren', steps: ['a', 'b', 'c', 'd'] }
  it('names the chain in step order, each teammate once in a row, the checker marked', () => {
    expect(routineChain({ ...routine, handOffs: [{}, {}, { teammateId: 'tm_atlas' }, { teammateId: 'tm_sable', check: true }] }, [WREN, ATLAS, SABLE])).toBe('Wren → Atlas → Sable (checks)')
    expect(routineChain({ ...routine, handOffs: [{}, { teammateId: 'tm_atlas' }, {}, { check: true }] }, [WREN, ATLAS])).toBe('Wren → Atlas → Wren → Wren (checks)')
  })

  it('says nothing new for a routine one teammate runs throughout', () => {
    expect(routineChain(routine, [WREN])).toBeUndefined()
    expect(routineChain({ ...routine, handOffs: [{}, {}, {}, {}] }, [WREN])).toBeUndefined()
  })
})
