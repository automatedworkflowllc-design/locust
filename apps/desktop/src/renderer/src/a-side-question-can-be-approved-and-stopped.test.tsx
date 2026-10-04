import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { SideChat } from './components/SideChat.js'

/**
 * A SIDE QUESTION CAN BE APPROVED AND STOPPED FROM ITS PANEL
 * (QA-2026-09-29 round 2, R33).
 *
 * The panel was a thread given no approvals and no Stop: a side run that
 * asked about a connector read "1 needs you" in the title bar and
 * "Answering..." in the panel, with nothing there to answer.
 */
const APPROVAL: MissionApprovalRequest = {
  approvalId: 'ap_1',
  runId: 'run_side',
  missionId: 'mission_side',
  kind: 'connector',
  summary: 'Use create_issue on github',
  detail: '{\n  "title": "x"\n}',
  cwd: 'C:/work',
  requestedAt: '2026-09-29T12:00:00.000Z',
  runtime: 'claude'
}

const panel = (phase: string, approvals: readonly MissionApprovalRequest[]): string =>
  renderToStaticMarkup(
    <SideChat
      turns={[{ key: 'run_side', prompt: 'Why did it pick Postgres?', events: [], phase, missionId: 'mission_side' }]}
      model="Opus 5.5"
      workspacePath="C:/work"
      onAsk={async () => undefined}
      onClose={() => undefined}
      approvals={approvals}
      decidingIds={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      onStop={() => undefined}
    />
  )

describe('the side panel', () => {
  it('shows the approval its run is waiting on, with its buttons', () => {
    const html = panel('running', [APPROVAL])
    expect(html).toContain('Use create_issue on github')
    expect(html).toContain('Approve once')
  })

  it('offers Stop while it answers, and Ask when it is done', () => {
    expect(panel('running', [])).toContain('aria-label="Stop this answer"')
    const done = panel('completed', [])
    expect(done).not.toContain('Stop this answer')
    expect(done).toContain('aria-label="Ask on the side"')
  })
})
