import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import { RoutineDialog } from './components/RoutineDialog.js'
import { routineChain } from './routines.js'

/**
 * A ROUTINE SAYS WHAT IT RUNS ON (0.493). Grok's 0.489 pass: the routine row
 * named the people and never a model, the edit dialog said only "Wren runs
 * it", every routine said "A routine saved read-only stays read-only" --
 * the ones that write included -- and an edit made mid-run reached the run
 * without a word. Colin, the same day: Robin's routine ran Grok 4.6 though
 * Robin was on 4.7. A step now runs on its teammate's model at the time, in
 * the mode it was saved with, and the routine says so.
 */
const team = [
  { teammateId: 'tm_wren', name: 'Wren', route: { runtime: 'cursor', model: 'grok-4.7-high' } },
  { teammateId: 'tm_sable', name: 'Sable', route: { runtime: 'opencode', model: 'opencode/nemotron-3.5-lightning-free' } }
]

describe('the routine row', () => {
  it('names each teammate with the model their steps run on', () => {
    const chain = routineChain({ teammateId: 'tm_wren', steps: ['a', 'b'], handOffs: [{}, { teammateId: 'tm_sable', check: true }] }, team, true)
    expect(chain).toMatch(/^Wren \(Grok 4\.7[^)]*\) → Sable \([^)]*Nemotron[^)]*\) \(checks\)$/)
  })

  it('names the one teammate of a plain routine with its model too', () => {
    expect(routineChain({ teammateId: 'tm_wren', steps: ['a'] }, team, true)).toMatch(/^Wren \(Grok 4\.7/)
    // As before where models are not asked for.
    expect(routineChain({ teammateId: 'tm_wren', steps: ['a'] }, team)).toBeUndefined()
  })
})

describe('the routine dialog', () => {
  const wren = { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code', createdAt: '2026-09-01T00:00:00.000Z', avatar: seedAvatar('tm_wren'), route: { runtime: 'cursor', model: 'grok-4.7-high', mode: 'accept-edits' } } as unknown as PublicTeammate
  const dialog = (props: { readonly running?: boolean }) =>
    renderToStaticMarkup(
      <RoutineDialog
        teammate={wren}
        initialName="Todo page chain"
        initialSteps={['Write a todo page.']}
        initialSchedule={undefined}
        truncated={false}
        routeLabel="Cursor / Grok 4.7"
        editing
        modeName="Edit"
        {...(props.running === undefined ? {} : { running: props.running })}
        busy={false}
        error={undefined}
        onSave={() => undefined}
        onCancel={() => undefined}
      />
    )

  it('says the model and the mode it runs in, not a rule about read-only', () => {
    const html = dialog({})
    expect(html).toContain('Edit routine')
    expect(html).toContain('runs it on Cursor / Grok 4.7, in Edit.')
    expect(html).toContain("Each run uses the model Wren last worked on, and always Edit.")
    expect(html).not.toContain('stays read-only')
  })

  it('says a run going now keeps the steps it started with', () => {
    expect(dialog({ running: true })).toContain('That run keeps the steps it started with; your changes apply from the next run.')
    expect(dialog({})).not.toContain('That run keeps the steps')
  })
})
