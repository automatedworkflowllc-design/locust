import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createClaudeEventNormalizer } from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import RECORDED from '../../../../../packages/runtime-adapters/test/fixtures/claude/helper-calls.jsonl?raw'
import NO_HELPER from '../../../../../packages/runtime-adapters/test/fixtures/claude/background-stopped-with-run.jsonl?raw'
import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { ActivityCard, HelperCalls, helperCallCount } from './components/ActivityCard.js'
import { ApprovalCard } from './components/ApprovalCard.js'
import { activityEntries, buildThread, helperAskedBy } from './missionView.js'
import type { ActivityDetail, ActivityEntry } from './missionView.js'

/*
 * A HELPER'S OWN CALLS FOLD UNDER ITS ROW (helper visibility, 2026-10-05).
 *
 * Colin: "is there a place that we can/should show subagent activity? ...
 * users are probably going to want to inspect when one of the
 * 'helpers/agents' is sent out." The helper's row said what it was asked and
 * what it came back with; what it did in between was dropped. The recording
 * (`packages/runtime-adapters/test/fixtures/claude/helper-calls.jsonl`) is a
 * real Haiku 4.5 run asked to use a helper to count five files: the Explore
 * helper went to the background, made one Glob, and reported 5.
 */

const AGENT = 'toolu_01MrF76nyTfdvLaECwMtcA7V'
const GLOB = 'toolu_0134dcHNk1GH8kL57hFJ7THL'

function normalize(text: string): readonly NormalizedRuntimeEvent[] {
  const n = createClaudeEventNormalizer({ runId: 'run_1', missionId: 'mission_1', now: () => new Date('2026-10-05T05:00:00.000Z') })
  return text.trimEnd().split('\n').flatMap((raw, index) => n.accept({ sequence: index + 1, raw }))
}

/** Every row the thread drew, across its groups of steps. */
function detailsOf(events: readonly NormalizedRuntimeEvent[]): readonly ActivityDetail[] {
  return buildThread(events, { running: false }).flatMap((item) => ('details' in item ? (item as { readonly details: readonly ActivityDetail[] }).details : []))
}

const withoutChildren = (details: readonly ActivityDetail[]): readonly ActivityDetail[] =>
  details.map(({ children: _children, ...rest }) => rest)

const helperEntry = (entries: readonly ActivityEntry[]): Extract<ActivityEntry, { kind: 'helper' }> => {
  const found = entries.find((entry) => entry.kind === 'helper')
  if (found?.kind !== 'helper') throw new Error('no helper row')
  return found
}

describe("a helper's own calls", () => {
  const events = normalize(RECORDED)

  it("are kept under the helper's row, as the rows the teammate's calls use", () => {
    const helper = detailsOf(events).find((detail) => detail.kind === 'helper')
    expect(helper?.children?.map((child) => [child.tool, child.name, child.settled, child.failed])).toEqual([['Glob', '**/*', true, false]])
    const entry = helperEntry(activityEntries(detailsOf(events)))
    expect(entry.subagentType).toBe('Explore')
    expect(entry.calls?.map((call) => call.kind)).toEqual(['tool'])
    expect(helperCallCount(entry.calls ?? [])).toBe('1 call')
  })

  it("leave the teammate's own rows as they read without the helper's calls", () => {
    const own = events.filter((event) => (event.payload as { readonly parentItemId?: unknown }).parentItemId === undefined)
    expect(withoutChildren(detailsOf(events))).toEqual(detailsOf(own))
  })

  it('count on the helper row and stay folded until it is pressed', () => {
    const html = renderToStaticMarkup(<ActivityCard summary="" details={detailsOf(events)} runtimeName="Claude Code" workspacePath={undefined} finished openByDefault />)
    expect(html).toContain('1 call')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('What the helper did')
  })

  it('open onto each call, one step in, saying how it ended', () => {
    const entry = helperEntry(activityEntries(detailsOf(events)))
    const html = renderToStaticMarkup(<HelperCalls calls={entry.calls ?? []} finished workspacePath={undefined} />)
    expect(html).toContain('What the helper did')
    expect(html).toContain('**/*')
    expect(html).toContain('>done<')
  })

  it('are nothing at all where no helper ran: no row gains children', () => {
    expect(detailsOf(normalize(NO_HELPER)).filter((detail) => detail.children !== undefined)).toEqual([])
  })
})

describe('a card a helper raised', () => {
  const events = normalize(RECORDED)
  const request = (toolUseId: string | undefined): MissionApprovalRequest => ({
    approvalId: 'ap_1',
    runId: 'run_1',
    missionId: 'mission_1',
    kind: 'command',
    summary: 'Use Glob',
    detail: '**/*',
    cwd: null,
    requestedAt: '2026-10-05T05:00:00.000Z',
    runtime: 'claude',
    ...(toolUseId === undefined ? {} : { toolUseId })
  })

  it('names the helper and whose it is', () => {
    expect(helperAskedBy(GLOB, events, 'Wren')).toBe('the Explore helper of Wren')
    const html = renderToStaticMarkup(
      <ApprovalCard request={request(GLOB)} askedBy={helperAskedBy(GLOB, events, 'Wren')} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />
    )
    expect(html).toContain('Asked by')
    expect(html).toContain('the Explore helper of Wren')
  })

  it("says nothing of a helper when the teammate asked, or the call is not known", () => {
    expect(helperAskedBy(AGENT, events, 'Wren')).toBeUndefined()
    expect(helperAskedBy(undefined, events, 'Wren')).toBeUndefined()
    expect(helperAskedBy('toolu_unknown', events, 'Wren')).toBeUndefined()
    const html = renderToStaticMarkup(<ApprovalCard request={request(AGENT)} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />)
    expect(html).not.toContain('Asked by')
  })
})
