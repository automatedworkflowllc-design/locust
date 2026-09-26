import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AutomationsScreen } from './components/AutomationsScreen.js'
import { CliArtifacts, inventorySummary } from './components/CliArtifacts.js'
import { seedAvatar } from '../../shared/avatar.js'
import type { PublicRuntimeArtifact, PublicTeammate } from '../../shared/ipc.js'

/**
 * The shelf holds one species, and is called what that species is called.
 *
 * The design agent's reading, 2026-09-10: **routines are yours to run; CLI
 * artifacts are facts about a runtime's own config file.** They shared only
 * the word "automation", and putting the second under a heading that
 * otherwise means *things you can run* is what made the inertness read as
 * brokenness -- the code's own comment already said a Run button on one would
 * be a promise the app cannot keep.
 *
 * With the second list moved under the runtime it belongs to, the screen
 * should be called what every control on it already calls the object. The app
 * says `Save as routine`, `Edit routine`, `routineRunSummary` -- routine
 * everywhere except the one place a person reads first.
 */

const WREN: PublicTeammate = {
  teammateId: 'tm_wren',
  name: 'Wren',
  hue: 'lime',
  role: 'Code & Migrations',
  avatar: seedAvatar('tm_wren'),
  createdAt: '2026-09-05T05:00:00.000Z'
}

/** A real Windows separator, never typed inline. */
const SEP = String.fromCharCode(92)

const ARTIFACT: PublicRuntimeArtifact = {
  runtime: 'codex',
  kind: 'agent',
  name: 'gig-scout',
  // Built from a constant rather than typed: a literal Windows path in a
  // source file is one escape away from being a different string, and
  // this fixture exists to check the SPLIT.
  path: ['C:', 'Users', '<home>', '.codex', 'agents', 'gig-scout.md'].join(SEP)
} as PublicRuntimeArtifact

const shelf = (over: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    <AutomationsScreen
      routines={[]}
      teammates={[WREN]}
      routineStepByTeammate={{}}
      onRunRoutine={() => undefined}
      onEditRoutine={() => undefined}
      onRemoveRoutine={() => undefined}
      notice={undefined}
      onDismissNotice={() => undefined}
      {...over}
    />
  )

describe('the routines shelf', () => {
  it('is called Routines, in its heading and to a screen reader', () => {
    const html = shelf()
    expect(html).toContain('>Routines<')
    expect(html).toContain('aria-label="Routines"')
    expect(html).not.toContain('>Automations<')
  })

  it('no longer holds the things a person cannot run', () => {
    // The second species is gone from this screen entirely -- not relabelled,
    // not collapsed. It is a fact about a runtime and it lives under one.
    const html = shelf()
    expect(html).not.toContain('Set up in your CLIs')
    expect(html).not.toContain('does not run them')
  })

  it('offers finished conversations instead of describing a right-click', () => {
    const html = shelf({
      missions: [
        { missionId: 'm1', title: 'Friday release checks', phase: 'completed', turns: 4, lastAt: '2026-09-10T04:00:00.000Z', ownerId: 'tm_wren' },
        { missionId: 'm2', title: 'Still going', phase: 'running', turns: 2, lastAt: '2026-09-10T05:00:00.000Z' }
      ],
      onSaveRoutine: () => undefined
    })
    expect(html).toContain('Friday release checks')
    expect(html).toContain('4 turns')
    // Says what it makes (0.355): a bare "Save" did not.
    expect(html).toContain('>Save as routine<')
    // The running one is not on offer, and the gesture is not narrated.
    expect(html).not.toContain('Still going')
    expect(html).not.toContain('right-click')
  })

  it('says the honest sentence when a workspace has finished nothing at all', () => {
    const html = shelf({ missions: [], onSaveRoutine: () => undefined })
    expect(html).toContain('Finish a conversation and it can be saved here as a routine.')
    expect(html).not.toContain('right-click')
    // No New routine: a routine cannot be made from nothing, and a blank form
    // would be a lie about what it is.
    expect(html).not.toContain('New routine')
  })
})

describe('what was configured inside a CLI', () => {
  it('is listed as a fact about that runtime, with no apology needed', () => {
    const html = renderToStaticMarkup(<CliArtifacts artifacts={[ARTIFACT]} />)
    expect(html).toContain('gig-scout')
    expect(html).toContain('1 agent set up in this CLI')
    expect(html).toContain('it does not run them')
    // Folded, with the count on the fold (the review, P3): a closed details.
    expect(html).toMatch(/^<details class="lc-cliartifacts"><summary/)
    expect(inventorySummary([ARTIFACT, ARTIFACT, { ...ARTIFACT, kind: 'command' }])).toBe('2 agents · 1 command')
    // The runtime is not named again: it is the row directly above.
    expect(html).not.toContain('Codex CLI')
    // The tail of the path answers "where do I change it" without running off
    // the edge of the window, which a full Windows path did.
    expect(html).toContain('agents/gig-scout.md')
    expect(html).not.toContain(`>C:${SEP}Users`)
  })

  it('draws nothing at all for a runtime that has none', () => {
    expect(renderToStaticMarkup(<CliArtifacts artifacts={[]} />)).toBe('')
  })
})
