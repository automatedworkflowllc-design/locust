import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import APP from './App.tsx?raw'
import { TerminalDivider } from './components/TerminalDivider.js'
import { Thread } from './components/Thread.js'
import { conversationTurns, terminalSeamBefore, turnAttachments, turnPromptLine } from './missionView.js'

/**
 * WHAT HAPPENED IN THE TERMINAL IS DRAWN AS YOURS (0.391).
 *
 * Colin, 2026-09-27: "wont we want to be able to keep up on projects our
 * users carry on w/ terminal?" An exchange the person had in the runtime's
 * own terminal comes back as a turn of the conversation: their words in their
 * bubble, the answer under it, and a seam either side saying where it was had.
 */
function recorded(overrides: Partial<PublicRecoveredMission>): PublicRecoveredMission {
  return {
    missionId: 'mission_1',
    runId: 'run_1',
    workspaceId: 'ws_test',
    prompt: 'Who takes what?',
    runtime: 'claude',
    model: 'opus',
    requestedRouteId: 'claude:opus',
    resolvedRouteId: 'claude:opus',
    cliVersion: null,
    createdAt: '2026-09-27T09:58:00.000Z',
    lastUpdatedAt: '2026-09-27T10:00:00.000Z',
    phase: 'completed',
    events: [],
    eventCount: 0,
    eventsTruncated: false,
    integrityIssueCount: 0,
    sandbox: 'workspace-write',
    checkpoints: [],
    peerMessages: [],
    ...overrides
  }
}
const follow = (missionId: string) => ({ continuesFrom: { missionId, checkpointEpoch: 1, reason: 'follow-up' as const } })
const first = recorded({})
const typedThere = recorded({ missionId: 'mission_2', prompt: 'Now add tests.', startedBy: { kind: 'terminal', exchange: 1 }, ...follow('mission_1') })
const alsoThere = recorded({ missionId: 'mission_3', prompt: 'Commit them.', startedBy: { kind: 'terminal', exchange: 2 }, ...follow('mission_2') })
const backHere = recorded({ missionId: 'mission_4', prompt: 'What changed?', ...follow('mission_3') })
const byId = new Map([first, typedThere, alsoThere, backHere].map((mission) => [mission.missionId, mission] as const))

describe('a turn typed in the terminal', () => {
  it("is the person's own words, with nothing attached", () => {
    expect(turnPromptLine({ prompt: 'Now add tests.', startedBy: { kind: 'terminal', exchange: 1 } })).toBe('Now add tests.')
    expect(turnAttachments({ prompt: 'Now add tests.', startedBy: { kind: 'terminal', exchange: 1 } })).toEqual([])
  })

  it("carries its runtime through the conversation's turns, and Locust's own turns do not", () => {
    expect(conversationTurns(backHere, byId).map((turn) => [turn.missionId, turn.inTerminal])).toEqual([
      ['mission_1', undefined],
      ['mission_2', 'claude'],
      ['mission_3', 'claude'],
      ['mission_4', undefined]
    ])
  })
})

describe('the seams', () => {
  it('go into the terminal before its first turn, and back in Locust before the next of its own', () => {
    expect(terminalSeamBefore(undefined, 'claude')).toEqual({ into: 'claude' })
    expect(terminalSeamBefore('claude', 'claude')).toBeUndefined()
    expect(terminalSeamBefore('claude', undefined)).toEqual({ back: true })
    expect(terminalSeamBefore(undefined, undefined)).toBeUndefined()
    expect(terminalSeamBefore('claude', 'codex')).toEqual({ into: 'codex' })
  })

  it("say whose terminal, and that it ran with that runtime's own permissions", () => {
    const into = renderToStaticMarkup(<TerminalDivider seam={{ into: 'claude' }} />)
    expect(into).toContain('aria-label="In Claude Code&#x27;s terminal"')
    expect(into).toContain('<span class="lc-handoff__to">Claude Code</span>')
    expect(into).toContain("Claude Code ran it with its own permissions, not this conversation&#x27;s mode.")
    expect(renderToStaticMarkup(<TerminalDivider seam={{ back: true }} />)).toContain('Back in Locust')
  })
})

describe('the thread', () => {
  const said = (text: string): NormalizedRuntimeEvent[] =>
    [
      { id: 'r:1', runId: 'r', sequence: 1, occurredAt: '2026-09-27T10:05:00.000Z', sourceAdapter: 'claude', type: 'run.started', payload: { runtimeThreadId: 's1' } },
      { id: 'r:2', runId: 'r', sequence: 2, occurredAt: '2026-09-27T10:06:00.000Z', sourceAdapter: 'claude', type: 'message.delta', payload: { itemId: 'terminal_answer', operation: 'replace', text, final: true } },
      { id: 'r:3', runId: 'r', sequence: 3, occurredAt: '2026-09-27T10:06:00.000Z', sourceAdapter: 'claude', type: 'run.completed', payload: {} }
    ] as unknown as NormalizedRuntimeEvent[]
  const thread = (current: { readonly inTerminal?: 'claude' }): string =>
    renderToStaticMarkup(
      <Thread
        prompt={current.inTerminal === undefined ? 'What changed?' : 'Commit them.'}
        onOpenPeerRun={() => undefined}
        earlierTurns={[
          { missionId: 'mission_1', prompt: 'Who takes what?', events: said('Wren takes the migrations.') },
          { missionId: 'mission_2', prompt: 'Now add tests.', events: said('Added three tests.'), inTerminal: 'claude' },
          ...(current.inTerminal === undefined ? [{ missionId: 'mission_3', prompt: 'Commit them.', events: said('Committed.'), inTerminal: 'claude' as const }] : [])
        ]}
        {...current}
        events={said(current.inTerminal === undefined ? 'Two files.' : 'Committed.')}
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
        peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      />
    )

  it('draws the terminal turns between one seam going in and one coming back, the words in order', () => {
    const html = thread({})
    const into = html.indexOf('In Claude Code&#x27;s terminal')
    const back = html.indexOf('Back in Locust')
    expect(into).toBeGreaterThan(html.indexOf('Who takes what?'))
    expect(html.indexOf('Now add tests.')).toBeGreaterThan(into)
    expect(html.indexOf('Commit them.')).toBeGreaterThan(html.indexOf('Now add tests.'))
    expect(back).toBeGreaterThan(html.indexOf('Commit them.'))
    expect(html.indexOf('What changed?')).toBeGreaterThan(back)
    expect(html.split('In Claude Code&#x27;s terminal').length - 1).toBe(1)
  })

  it('keeps the flag on every copy of a turn the window makes, the one a reply carries included', () => {
    // The 0.391 drive's reply drew "Back in Locust" between two terminal
    // turns: the copy made for the reply had dropped the flag.
    expect(APP).toContain('...inTerminalOf(continuing)')
    expect(APP).toContain('...inTerminalOf(live)')
    expect(APP).toContain('{...inTerminalOf(liveRun)}')
    expect(APP.split('...(turn.inTerminal === undefined ? {} : { inTerminal: turn.inTerminal })').length - 1).toBe(2)
    // One reading of the record's word, in the helper, not a copy per site.
    expect(APP.split("startedBy?.kind === 'terminal'").length - 1).toBe(1)
  })

  it('opens on a conversation whose newest turn was the terminal’s with the seam going in and none coming back', () => {
    const html = thread({ inTerminal: 'claude' })
    expect(html.split('In Claude Code&#x27;s terminal').length - 1).toBe(1)
    expect(html).not.toContain('Back in Locust')
  })
})
