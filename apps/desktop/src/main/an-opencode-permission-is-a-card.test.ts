import { describe, expect, it } from 'vitest'

import { createApprovalChannel, openCodePermissionRequest, openCodeReplyFor } from './approval-channel.js'
import type { MissionApprovalRequest } from '../shared/ipc.js'

/**
 * A6.7: what OpenCode's server asks becomes the card Codex's requests do, and
 * the person's answer goes back as the server's own reply.
 */
describe("an OpenCode server's permission request", () => {
  it('is a command card naming the command, from OpenCode, and the answer comes back as its reply', async () => {
    const raised: MissionApprovalRequest[] = []
    const channel = createApprovalChannel({ emitApproval: (request) => raised.push(request), createId: () => '1' })
    const handler = channel.requestHandlerFor({ runId: 'run_1', missionId: 'm_1', cwd: 'C:/work', changesByItem: new Map(), runtime: 'opencode' })
    const reply = handler(openCodePermissionRequest({ permission: 'bash', patterns: ['echo hi'], metadata: { command: 'echo hi' } }, 'C:/work'))
    expect(raised[0]).toMatchObject({ runtime: 'opencode', kind: 'command', detail: 'echo hi', summary: 'Run a command' })
    channel.decide({ approvalId: raised[0]!.approvalId, decision: 'approve-once' })
    expect(openCodeReplyFor(await reply)).toBe('once')
  })

  it('names an edit by its file, and anything else by what it is', () => {
    expect(openCodePermissionRequest({ permission: 'edit', patterns: ['a.txt'], metadata: { filepath: 'C:/work/a.txt' } }, 'C:/work'))
      .toMatchObject({ method: 'item/fileChange/requestApproval', params: { summary: 'C:/work/a.txt' } })
    expect(openCodePermissionRequest({ permission: 'external_directory', patterns: ['C:/other/*'], metadata: {} }, 'C:/work'))
      .toMatchObject({ method: 'item/commandExecution/requestApproval', params: { command: 'Reach outside its folder: C:/other/*' } })
  })

  it('reads "for the rest of the run" as always, and anything unclear as a refusal', () => {
    expect(openCodeReplyFor({ decision: 'acceptForSession' })).toBe('always')
    expect(openCodeReplyFor({ decision: 'reject' })).toBe('reject')
    expect(openCodeReplyFor(null)).toBe('reject')
    expect(openCodeReplyFor({ decision: 'accept', extra: 1 })).toBe('once')
  })
})
