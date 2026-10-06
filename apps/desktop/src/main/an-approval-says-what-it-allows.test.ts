import { describe, expect, it, vi } from 'vitest'

import { createApprovalChannel, openCodePermissionRequest } from './approval-channel.js'
import { alwaysCoversFor, builtInOrConnector } from './permission-host.js'
import type { FileChangeRecord } from './approval-patch.js'
import type { MissionApprovalRequest } from '../shared/ipc.js'

/**
 * AN APPROVAL SAYS WHAT IT ALLOWS (QA-2026-09-29 round 2, R35, R37, R15, R30).
 */
describe('an approval card', () => {
  it('says what Always lets through on Claude: the one tool, or every command for Bash', () => {
    expect(alwaysCoversFor('mcp__github__list_issues')).toBe('list_issues on github again, and no other tool')
    expect(alwaysCoversFor('Bash')).toBe('every command it runs')
  })

  it("carries OpenCode's own words to the card: a fetch, and what Always matches", () => {
    const raised: MissionApprovalRequest[] = []
    const channel = createApprovalChannel({ emitApproval: (request) => raised.push(request), createId: () => '1' })
    const handler = channel.requestHandlerFor({ runId: 'run_1', missionId: 'm_1', cwd: 'C:/work', changesByItem: new Map(), runtime: 'opencode' })
    void handler(openCodePermissionRequest({ permission: 'webfetch', patterns: ['https://example.com/'], always: ['*'], metadata: { url: 'https://example.com/' } }, 'C:/work'))
    expect(raised[0]).toMatchObject({
      summary: 'Fetch a web page',
      detail: 'https://example.com/',
      dataSentSays: 'The address above is requested from this machine, and the page it returns goes to the model.',
      alwaysCovers: 'every web page it asks to fetch'
    })
  })

  it("says when a subagent the teammate started is the one asking (R36)", () => {
    expect(openCodePermissionRequest({ permission: 'bash', patterns: ['echo FROM-SUBAGENT'], bySubagent: true, metadata: { command: 'echo FROM-SUBAGENT' } }, 'C:/work'))
      .toMatchObject({ params: { command: 'echo FROM-SUBAGENT', locustCard: { summary: 'Run a command, asked by a subagent it started' } } })
    expect(openCodePermissionRequest({ permission: 'webfetch', patterns: ['https://example.com/'], bySubagent: true, metadata: {} }, 'C:/work'))
      .toMatchObject({ params: { locustCard: { summary: 'Fetch a web page, asked by a subagent it started' } } })
    // The run's own request says nothing of the kind.
    expect(JSON.stringify(openCodePermissionRequest({ permission: 'bash', patterns: ['ls'], metadata: { command: 'ls' } }, 'C:/work'))).not.toContain('subagent')
  })

  it('says a Claude write outside the folder is outside it, and not undoable from here', () => {
    const card = builtInOrConnector('Write', { file_path: 'C:/Windows/System32/drivers/etc/hosts', content: 'x' }, 'C:/work')
    expect(card).toMatchObject({ kind: 'file-change', summary: 'Change 1 file outside your project folder', detail: 'C:/Windows/System32/drivers/etc/hosts' })
    expect(card.reversibleSays).toMatch(/^Not from here/)
    // Inside, as before.
    expect(builtInOrConnector('Write', { file_path: 'C:/work/notes.txt', content: 'x' }, 'C:/work')).toEqual({ kind: 'file-change', summary: 'Change 1 file', detail: 'notes.txt' })
  })

  it('draws a Codex file change whose approval arrived before its item was read', async () => {
    const raised: MissionApprovalRequest[] = []
    const changesByItem = new Map<string, readonly FileChangeRecord[]>()
    const channel = createApprovalChannel({ emitApproval: (request) => raised.push(request), createId: () => '2' })
    const handler = channel.requestHandlerFor({ runId: 'run_2', missionId: 'm_2', cwd: 'C:/work', changesByItem })
    void handler({ id: 7, method: 'item/fileChange/requestApproval', params: { itemId: 'item_1', cwd: 'C:/work' } })
    // The loop reads the item a few milliseconds later, as it did in the QA sweep at 0-3 ms.
    setTimeout(() => changesByItem.set('item_1', [{ path: 'C:/work/approved.txt', kind: 'add', movePath: undefined, diff: 'hello\n' }]), 5)
    await vi.waitFor(() => {
      expect(raised[0]).toMatchObject({ kind: 'file-change', summary: 'Change 1 file' })
      expect(raised[0]?.patch?.text).toContain('+hello')
    })
  })
})
