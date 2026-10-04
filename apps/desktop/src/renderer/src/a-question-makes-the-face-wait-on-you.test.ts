// Sol's 0.562 beta, act 3: a teammate that ended its turn on a question looked
// idle while the title bar said it needed you. Its face waits now (0.564).
import { describe, expect, it } from 'vitest'

import type { NeedsYouItem } from './needsYou.js'
import { waitingByTeammate } from './needsYou.js'
import { teammateStatusView } from './status.js'

const approval = (teammateId: string | undefined): NeedsYouItem => ({
  kind: 'approval', key: `approval:${teammateId ?? 'none'}`, missionId: 'mission_a', teammateId, name: 'Ada', what: 'Run npm test', asking: false, command: true
})
const decision = (teammateId: string | undefined, missionId = 'mission_b'): NeedsYouItem => ({
  kind: 'decision', key: `decision:${missionId}`, missionId, teammateId, name: 'Ada', what: 'Cyan or amber?'
})

describe('what a teammate waits on you for', () => {
  it('counts questions a teammate stopped on beside its paused runs', () => {
    const counts = waitingByTeammate([approval('tm_ada'), decision('tm_ada'), decision('tm_bo', 'mission_c')])
    expect(counts.get('tm_ada')).toBe(2)
    expect(counts.get('tm_bo')).toBe(1)
  })

  it('leaves out memory suggestions and items no teammate owns', () => {
    const counts = waitingByTeammate([{ kind: 'memory', key: 'memory', count: 3 }, decision(undefined), approval(undefined)])
    expect(counts.size).toBe(0)
  })

  it('a question alone makes the face wait, in amber, with nothing running', () => {
    const waiting = waitingByTeammate([decision('tm_ada')]).get('tm_ada') ?? 0
    const view = teammateStatusView({ runtime: undefined, hasRunningMission: false, pendingApprovals: waiting, roleLabel: 'Builder' })
    expect(view.activity).toBe('waiting')
    expect(view.tone).toBe('amber')
    expect(view.status).toBe('approval-needed')
  })

  it('a teammate with no question and no paused run stays idle', () => {
    const waiting = waitingByTeammate([decision('tm_bo')]).get('tm_ada') ?? 0
    const view = teammateStatusView({ runtime: undefined, hasRunningMission: false, pendingApprovals: waiting, roleLabel: 'Builder' })
    expect(view.activity).toBe('idle')
  })
})
