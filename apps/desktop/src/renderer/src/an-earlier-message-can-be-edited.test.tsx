import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Composer } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import { Thread } from './components/Thread.js'
import { turnVersions } from './missionView.js'

/**
 * AN EARLIER MESSAGE CAN BE EDITED (0.498). Sol's 0.491 pass looked for it on
 * the first message of a twenty-turn thread and found nothing; Claude Code has
 * it (Esc Esc) and so do Codex and claude.ai. Each message the person typed
 * carries an Edit; its words go back in the box under a line that says what
 * sending will do, and the new turn says it started again.
 */
const said = (text: string) => [{ type: 'message.delta', payload: { text } }]
const thread = (extra: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <Thread
      prompt="And the second thing"
      onOpenPeerRun={() => undefined}
      earlierTurns={[{ missionId: 'mission_one', prompt: 'The first thing', events: said('Done one.') as never }]}
      events={said('Done two.') as never}
      running={false}
      restoredMission={undefined}
      error={undefined}
      errorIsPersistence={false}
      startedAt={undefined}
      approvals={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      decidingIds={[]}
      cancelled={false}
      handoff={undefined}
      shownMissionId="mission_two"
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      {...extra}
    />
  )
const edits = (html: string): number => html.split('aria-label="Edit this message"').length - 1

describe('a sent message', () => {
  it('offers Edit on every message the person typed, inside its bubble', () => {
    const html = thread({ onEditMessage: () => undefined })
    expect(edits(html)).toBe(2)
    expect(html).toMatch(/<div class="lc-bubble">The first thing<button type="button" class="lc-bubble__edit" aria-label="Edit this message"/)
  })

  it('offers nothing while a turn runs, or where editing is not offered', () => {
    expect(edits(thread({}))).toBe(0)
    // Running: the latest turn has no Edit (the window does not pass one then either).
    expect(edits(thread({ onEditMessage: () => undefined, running: true }))).toBe(1)
  })

  it('offers nothing on a turn the person did not type', () => {
    const html = thread({
      onEditMessage: () => undefined,
      earlierTurns: [{ missionId: 'mission_one', prompt: 'The first thing', events: said('Done one.'), inTerminal: 'claude' }]
    })
    expect(edits(html)).toBe(1)
  })

  it('says above the new turn that it started again, and not that a fresh session began', () => {
    const html = thread({ rewound: true, coldStart: true })
    expect(html).toContain('Started again from an edited message.')
    expect(html).not.toContain('A fresh session')
  })
})

describe('the box, while an earlier message is edited', () => {
  const composer = (extra: Record<string, unknown>): string =>
    renderToStaticMarkup(
      <Composer
        {...({
          runtimes: [],
          limitedRuntimes: new Map(),
          discoveryPhase: 'ready',
          models: [],
          resolvedModels: new Map(),
          route: { runtime: 'claude', model: 'opus' },
          mode: 'ask',
          onModeChange: () => undefined,
          onRouteChange: () => undefined,
          onSend: () => undefined,
          running: false,
          platform: 'win32',
          ...extra
        } as unknown as ComposerProps)}
      />
    )

  it('says what sending will do, and offers Cancel', () => {
    const html = composer({ editingEarlier: { onCancel: () => undefined } })
    expect(html).toContain('Editing an earlier message')
    expect(html).toContain('Files stay as they are.')
    expect(html).toMatch(/<button type="button" class="lc-queued__action">Cancel<\/button>/)
  })

  it('says nothing of the kind otherwise', () => {
    expect(composer({})).not.toContain('Editing an earlier message')
  })
})

describe('the version before an edit (0.498)', () => {
  // one -> two -> three, then two was edited: one -> two' -> three'.
  const at = (minute: number): string => `2026-09-30T10:${String(minute).padStart(2, '0')}:00.000Z`
  const turn = (missionId: string, minute: number, from?: string, edited?: true) => ({
    missionId,
    createdAt: at(minute),
    ...(from === undefined ? {} : { continuesFrom: { missionId: from, reason: 'follow-up', ...(edited === undefined ? {} : { edited }) } })
  })
  const byId = new Map([
    turn('one', 1),
    turn('two', 2, 'one'),
    turn('three', 3, 'two'),
    turn('two_edited', 4, 'one', true),
    turn('three_edited', 5, 'two_edited')
  ].map((mission) => [mission.missionId, mission]))

  it('finds, for the edit, the newest turn of the version before it', () => {
    expect(turnVersions('two_edited', byId)).toEqual({ before: 'three' })
  })

  it('finds, for the replaced turn, the newest turn of the edit', () => {
    expect(turnVersions('two', byId)).toEqual({ after: 'three_edited' })
  })

  it('finds nothing for a turn no edit touched, or two follow-ups that are not an edit', () => {
    expect(turnVersions('one', byId)).toBeUndefined()
    expect(turnVersions('three_edited', byId)).toBeUndefined()
    const twice = new Map([turn('a', 1), turn('b', 2, 'a'), turn('c', 3, 'a')].map((mission) => [mission.missionId, mission]))
    expect(turnVersions('c', twice)).toBeUndefined()
    expect(turnVersions('b', twice)).toBeUndefined()
  })

  it('says so above the message, with the way to the other version', () => {
    const html = thread({
      onOpenVersion: () => undefined,
      earlierTurns: [{ missionId: 'mission_one', prompt: 'The first thing', events: said('Done one.'), versions: { before: 'mission_old' } }]
    })
    expect(html).toContain('Edited.')
    expect(html).toContain('>Show the version before</button>')
    expect(thread({ onOpenVersion: () => undefined, versions: { after: 'mission_new' } })).toContain('>Show the edited version</button>')
    expect(thread({ onOpenVersion: () => undefined, rewound: true, versions: { before: 'mission_old' } })).toMatch(/Started again from an edited message\.[^<]*<button[^>]*>Show the version before/)
  })
})
