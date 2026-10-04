import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { rootMission, typedPrompt } from './missionView.js'
import { collapseConversations } from './status.js'

/**
 * Colin, 2026-09-21: *"im having an issue where it keeps spawning a new
 * conversation after a workflow finishes, for that model specifically"*, then
 * a few minutes later *"yep it just did it again"*, with a screenshot showing
 * two CEO rows and a Boss/Flash row — *"i feel like they all spawned off the
 * same chat"*.
 *
 * **He was right, and nothing spawned.** Read from his own ledger before a
 * line was changed: his Antigravity chain is ONE unbroken run of **36 turns**
 * (`mission_3bd1ccbf` back to `mission_4c65cf41`), and the whole 131-mission
 * ledger holds only two true Antigravity roots. The sidebar was drawing one
 * conversation three times.
 *
 * The cause is one number. `rootMission` walked at most **32 hops** and then
 * returned whatever turn it had reached AS THE ROOT — so on a 36-turn chain
 * the newest turn reported a mid-chain pseudo-root while an older turn
 * reached the real one, and `collapseConversations`, which keys on exactly
 * that id, made them separate rows. Every further turn slides the window and
 * mints another: *"it just did it again"*.
 *
 * It got worse than cosmetic. `groups.json` had filed **three ids of this one
 * chain** — `4c65cf41` under Locust, `0f4888ce` and `9de113fa` under Chief —
 * because he had tidied the phantom rows into groups, which wrote membership
 * against mid-chain turns and made the split durable.
 *
 * The cap was never about depth: it is cycle protection for a hand-edited
 * `continuesFrom`, and a `seen` set is that exactly, with no number to be
 * wrong. Four walks carried four different numbers — 32, 64, 32, 64 — for
 * the same question.
 */
const turn = (index: number, parent: string | undefined): PublicRecoveredMission =>
  ({
    missionId: `mission_${String(index).padStart(3, '0')}`,
    prompt: index === 0 ? 'look into locust for me' : `turn ${String(index)}`,
    phase: 'completed',
    runtime: 'antigravity',
    integrityIssueCount: 0,
    lastUpdatedAt: `2026-09-21T00:${String(index).padStart(2, '0')}:00.000Z`,
    events: [],
    ...(parent === undefined ? {} : { continuesFrom: { missionId: parent, reason: 'follow-up' } })
  }) as unknown as PublicRecoveredMission

/** A chain of `length` turns, oldest first. */
const chainOf = (length: number): readonly PublicRecoveredMission[] =>
  Array.from({ length }, (_unused, index) => turn(index, index === 0 ? undefined : `mission_${String(index - 1).padStart(3, '0')}`))

const mapOf = (missions: readonly PublicRecoveredMission[]) =>
  new Map(missions.map((mission) => [mission.missionId, mission]))

describe('a long conversation is still one conversation', () => {
  it('finds the real root 36 turns back, which is Colin\u2019s chain', () => {
    const chain = chainOf(36)
    const byId = mapOf(chain)
    for (const mission of chain) {
      expect(rootMission(mission, byId).missionId, `${mission.missionId} lost its root`).toBe('mission_000')
    }
  })

  it('collapses every turn of it into ONE sidebar row', () => {
    // The whole symptom, end to end: build rows the way App.tsx does and
    // count them. Before the fix this was 5 rows for one conversation.
    const chain = chainOf(36)
    const byId = mapOf(chain)
    const rows = chain.map((mission) => ({
      missionId: mission.missionId,
      title: rootMission(mission, byId).prompt,
      phase: mission.phase,
      integrityIssueCount: 0,
      rootId: rootMission(mission, byId).missionId,
      ...(mission.continuesFrom === undefined ? {} : { parentId: mission.continuesFrom.missionId })
    }))
    const collapsed = collapseConversations(rows)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.turns).toBe(36)
    // And it is titled by what he actually typed at the start, not by turn 4.
    expect(collapsed[0]!.title).toBe('look into locust for me')
  })

  it('does not care how long the conversation gets', () => {
    // 33 is the first length the old cap could be wrong about; 200 is well
    // past anything a number would have been chosen for.
    for (const length of [33, 65, 200]) {
      const chain = chainOf(length)
      const byId = mapOf(chain)
      expect(rootMission(chain[length - 1]!, byId).missionId, `broke at ${String(length)}`).toBe('mission_000')
    }
  })

  it('still stops on a cycle rather than spinning', () => {
    // The one thing the counter was genuinely buying. A hand-edited ledger —
    // or a torn one — can point a turn at itself or at its own descendant.
    const a = turn(0, 'mission_001')
    const b = turn(1, 'mission_000')
    const byId = mapOf([a, b])
    expect(['mission_000', 'mission_001']).toContain(rootMission(b, byId).missionId)
    expect(typeof typedPrompt(b, byId)).toBe('string')
  })

  it('stops at a turn that is missing rather than guessing past it', () => {
    // A deleted or unreadable ancestor ends the walk where it stands, which
    // is the pre-existing behaviour and must not change.
    const chain = chainOf(10).slice(4)
    const byId = mapOf(chain)
    expect(rootMission(chain.at(-1)!, byId).missionId).toBe('mission_004')
  })
})
