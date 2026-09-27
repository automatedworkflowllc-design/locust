import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicTeammate } from '../../shared/ipc.js'
import { seedAvatar } from '../../shared/avatar.js'
import APP from './App.tsx?raw'
import { BesideConversation } from './components/BesideConversation.js'

/**
 * A CONVERSATION OPENS BESIDE ANOTHER (0.396, Orca's item 4).
 *
 * Two teammates side by side: one conversation in the middle with the chat
 * box, a second in the panel a file opens in -- read-only, live, and one
 * press from being the one in the middle.
 */
const SABLE: PublicTeammate = { teammateId: 'tm_sable', name: 'Sable', role: 'Data & Reporting', hue: 'blue', avatar: seedAvatar('tm_sable'), route: { runtime: 'opencode', model: 'opencode/free', mode: 'accept-edits' }, createdAt: '2026-09-27T05:00:00.000Z' }
const said = [
  { id: 'r:1', runId: 'r', sequence: 1, occurredAt: '2026-09-27T10:00:00.000Z', sourceAdapter: 'opencode', type: 'run.started', payload: {} },
  { id: 'r:2', runId: 'r', sequence: 2, occurredAt: '2026-09-27T10:00:01.000Z', sourceAdapter: 'opencode', type: 'message.delta', payload: { itemId: 'm', operation: 'append', text: '1\n2\n3', final: false } }
] as unknown as NormalizedRuntimeEvent[]

const panel = (phase: string): string =>
  renderToStaticMarkup(
    <BesideConversation
      run={{ prompt: 'Count from 1 to 150.', events: said, phase, data: { missionId: 'mission_sable' } }}
      title="Count from 1 to 150."
      owner={SABLE}
      teammates={[SABLE]}
      workspacePath={undefined}
      onOpenHere={() => undefined}
      onClose={() => undefined}
    />
  )

describe('the panel beside', () => {
  it("names whose conversation it is, and offers to open it here or close it", () => {
    const html = panel('running')
    expect(html).toContain('aria-label="Beside: Count from 1 to 150."')
    expect(html).toContain('<span class="lc-viewer__name">Sable</span>')
    expect(html).toContain('aria-label="Open it here"')
    expect(html).toContain('aria-label="Close"')
  })

  it('draws the conversation itself -- what was asked and what has come back so far', () => {
    const html = panel('running')
    expect(html).toContain('Count from 1 to 150.')
    expect(html).toMatch(/1\s*2\s*3|1<br\/>2/)
  })

  it('has no chat box of its own: a message goes to the conversation in the middle', () => {
    expect(panel('completed')).not.toContain('command-dock')
  })
})

describe('where it opens', () => {
  it("is offered on a conversation's right-click menu", () => {
    expect(APP).toContain("{ label: 'Open beside', shortcut: 'b', onSelect: () => setBesideId(missionId) }")
  })

  it('shares the file panel: an open file wins, then the conversation beside, then the inspector', () => {
    const file = APP.indexOf('{viewingFile !== undefined && screen === \'workroom\' ? (')
    const beside = APP.indexOf(") : besideRun !== undefined && screen === 'workroom' ? (")
    const inspector = APP.indexOf("inspectorOpen && liveRun !== undefined && screen === 'workroom' && (\n            <Inspector")
    expect(file).toBeGreaterThan(-1)
    expect(beside).toBeGreaterThan(file)
    expect(inspector).toBeGreaterThan(beside)
    // And the middle makes room for it the way it does for a file.
    expect(APP).toContain("besideRun !== undefined) && screen === 'workroom' ? ' has-viewer'")
  })

  it('never draws the conversation already in the middle a second time', () => {
    expect(APP).toContain('if (liveRun?.data?.missionId !== undefined && members.includes(liveRun.data.missionId)) return undefined')
  })
})
