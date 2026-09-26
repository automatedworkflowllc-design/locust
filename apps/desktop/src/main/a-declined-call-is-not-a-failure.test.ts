import { describe, expect, it } from 'vitest'

import type { AppServerRequest, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { createApprovalChannel, withDeclines } from './approval-channel.js'
import type { MissionApprovalRequest } from '../shared/ipc.js'
import type { FileChangeRecord } from './approval-patch.js'

/**
 * A DECLINED CALL IS NOT A FAILURE (0.374).
 *
 * Codex 0.157 runs a command inside a script, and a declined approval comes
 * back as the script failing -- `Rejected("approval request failed")` -- so the
 * row read "failed" in red and the fold counted a command that "exited
 * non-zero" (drive-deny-with-reason on Codex, twice). Locust answered that
 * approval itself; the item it declined is said as declined.
 */
const failed = (itemId: string, status = 'failed'): NormalizedRuntimeEvent =>
  ({ type: 'tool.failed', payload: { itemId, toolKind: 'commandExecution', command: 'git status', status, exitCode: 1, phase: 'completed' } }) as unknown as NormalizedRuntimeEvent

describe('an item the person declined', () => {
  it('is said as declined when it fails, and nothing else changes', () => {
    const completed = { type: 'tool.completed', payload: { itemId: 'item_1' } } as unknown as NormalizedRuntimeEvent
    const out = withDeclines([failed('item_1'), failed('item_2'), completed], new Set(['item_1']))
    expect((out[0]!.payload as { status: string }).status).toBe('declined')
    expect((out[1]!.payload as { status: string }).status).toBe('failed')
    expect(out[2]).toBe(completed)
  })

  it('is left alone when there is nothing declined', () => {
    const events = [failed('item_1')]
    expect(withDeclines(events, undefined)).toBe(events)
    expect(withDeclines(events, new Set())).toBe(events)
  })
})

describe('the approval channel', () => {
  const setup = () => {
    const cards: MissionApprovalRequest[] = []
    let n = 0
    const channel = createApprovalChannel({ emitApproval: (card) => cards.push(card), createId: () => String(++n) })
    const handler = channel.requestHandlerFor({ runId: 'run_1', missionId: 'mission_1', cwd: 'C:\\work', changesByItem: new Map<string, readonly FileChangeRecord[]>() })
    const ask = (itemId: string) =>
      handler({ id: 1, method: 'item/commandExecution/requestApproval', params: { itemId, command: 'git status', cwd: 'C:\\work' } } as AppServerRequest)
    return { channel, cards, ask }
  }

  it('remembers the items the person declined in a run -- and only those, and only while the run lasts', async () => {
    const { channel, cards, ask } = setup()
    void ask('item_denied')
    void ask('item_approved')
    await Promise.resolve()
    channel.decide({ approvalId: cards[0]!.approvalId, decision: 'deny' })
    channel.decide({ approvalId: cards[1]!.approvalId, decision: 'approve-once' })
    expect([...channel.declined('run_1')]).toEqual(['item_denied'])
    expect([...channel.declined('run_other')]).toEqual([])
    channel.release('run_1')
    expect([...channel.declined('run_1')]).toEqual([])
  })
})
