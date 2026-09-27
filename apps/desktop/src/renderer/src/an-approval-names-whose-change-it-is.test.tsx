import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { ApprovalCard } from './components/ApprovalCard.js'

/**
 * AN APPROVAL NAMES WHOSE CHANGE IT IS (0.392).
 *
 * The 0.390 beta pass: an edit OpenCode asked to make, in Approve each, was
 * headed "The change, as Codex would apply it" -- under a card that correctly
 * said OpenCode at its top. The patch head was written when Codex was the
 * only runtime that could ask.
 */
const request = (runtime: MissionApprovalRequest['runtime']): MissionApprovalRequest => ({
  approvalId: 'ap_1',
  runId: 'run_1',
  missionId: 'mission_1',
  kind: 'file-change',
  summary: 'Edit approval.txt',
  detail: 'approval.txt',
  cwd: null,
  requestedAt: '2026-09-27T10:00:00.000Z',
  ...(runtime === undefined ? {} : { runtime }),
  patch: { text: '--- a/approval.txt\n+++ b/approval.txt\n@@ -1 +1 @@\n-draft\n+keep\n', added: 1, removed: 1, truncated: false }
})
const card = (runtime: MissionApprovalRequest['runtime']): string =>
  renderToStaticMarkup(<ApprovalCard request={request(runtime)} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />)

describe("an approval's patch", () => {
  it('is headed by the runtime asking, not by Codex', () => {
    expect(card('opencode')).toContain('The change, as OpenCode would apply it')
    expect(card('opencode')).not.toContain('as Codex')
    expect(card('claude')).toContain('The change, as Claude Code would apply it')
  })

  it("still says Codex for a request recorded before runtimes were named on it", () => {
    expect(card(undefined)).toContain('The change, as Codex CLI would apply it')
  })
})
