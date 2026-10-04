import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { MissionApproval, RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { APPROVAL_NOT_RECORDED, approvalNotRecordedNote, createUnwrittenAnswers } from './approval-record-note.js'

/*
 * AN UNWRITTEN CARD ANSWER IS SAID IN THE RECORD (0.587, QA's Q2). The 0.576
 * write of a card's answer was un-awaited and its failure swallowed; the
 * saved record then claimed every answer was there. A refused answer waits
 * for the run to end (a live run's events are numbered by its adapter, and a
 * note slipped in between would take the next event's number), is tried once
 * more, and still refused leaves a host note one past the last event. A turn
 * too old to hold cards leaves none.
 */

const mission = {
  events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 7 }] as unknown as { readonly sequence: number }[],
  metadata: { runId: 'run_1', runtime: 'codex' }
} as unknown as RecoveredMission

const approval: MissionApproval = {
  approvalId: 'ap_1', kind: 'command', asked: 'Run a command\nnpm test', answer: 'allowed', by: 'card',
  askedAt: '2026-10-04T11:59:00.000Z', occurredAt: '2026-10-04T12:00:00.000Z'
}

describe('the note for an answer that could not be written down', () => {
  it('names the card, the answer and the ledger\'s reason, one past the last sequence', () => {
    const note = approvalNotRecordedNote({
      mission,
      runId: 'run_1',
      missionId: 'mission_1',
      kind: 'command',
      answer: 'allowed',
      why: 'EACCES: permission denied, open ledger\nat Object.openSync',
      now: () => new Date('2026-10-04T12:00:00.000Z')
    })
    expect(note).toMatchObject({
      id: 'run_1:approval-not-recorded:8',
      runId: 'run_1',
      missionId: 'mission_1',
      sequence: 8,
      type: 'adapter.diagnostic',
      occurredAt: '2026-10-04T12:00:00.000Z',
      sourceAdapter: 'codex',
      payload: { level: 'warning', code: APPROVAL_NOT_RECORDED, message: 'The answer to a card (command, allowed) could not be written to this record: EACCES: permission denied, open ledger', terminal: false }
    })
  })

  it('leaves nothing on a turn too old to hold cards (control), and starts at 1 on an empty mission', () => {
    expect(approvalNotRecordedNote({ mission, runId: 'run_1', missionId: 'mission_1', kind: 'command', answer: 'denied', why: 'Mission ledger version cannot hold approvals' })).toBeUndefined()
    const fresh = { events: [], metadata: { runId: 'run_2', runtime: 'claude' } } as unknown as RecoveredMission
    expect(approvalNotRecordedNote({ mission: fresh, runId: 'run_2', missionId: 'mission_2', kind: 'question', answer: 'answered', why: 'disk full' })).toMatchObject({ sequence: 1, sourceAdapter: 'claude' })
  })
})

/** A ledger that refuses the answer's record a set number of times, and holds the mission's tail. */
function fakeLedger(input: { readonly refusals: number; readonly tailTakenOnce?: boolean }) {
  const approvals: MissionApproval[] = []
  const events: NormalizedRuntimeEvent[] = []
  let refusals = input.refusals
  let tailTaken = input.tailTakenOnce === true
  let tail = 7
  let reads = 0
  const ledger = {
    appendApproval: async (_missionId: string, record: MissionApproval): Promise<void> => {
      if (refusals > 0) {
        refusals -= 1
        throw new Error('EBUSY: resource busy or locked')
      }
      approvals.push(record)
    },
    getMission: async (): Promise<RecoveredMission | undefined> => {
      reads += 1
      return { events: [{ sequence: tail }], metadata: { runId: 'run_1', runtime: 'codex' } } as unknown as RecoveredMission
    },
    appendEvents: async (_missionId: string, added: readonly NormalizedRuntimeEvent[]): Promise<void> => {
      if (tailTaken) {
        // Another run-end writer appended first: the tail moved on, the ledger refused.
        tailTaken = false
        tail += 1
        throw new Error('Mission event sequence is invalid')
      }
      events.push(...added)
    }
  }
  return { ledger, approvals, events, reads: () => reads }
}

describe('an answer the ledger refused, when the run ends', () => {
  it('is written after all when the ledger takes it the second time, and no note is left', async () => {
    const fake = fakeLedger({ refusals: 1 })
    const unwritten = createUnwrittenAnswers({ ledger: fake.ledger })
    await expect(fake.ledger.appendApproval('mission_1', approval)).rejects.toThrow('EBUSY')
    unwritten.remember('mission_1', approval, 'EBUSY: resource busy or locked')
    expect(unwritten.pending('mission_1')).toBe(1)
    await unwritten.onRunEnded({ missionId: 'mission_1' })
    expect(fake.approvals).toEqual([approval])
    expect(fake.events).toEqual([])
    expect(unwritten.pending('mission_1')).toBe(0)
  })

  it('still refused, leaves the note one past the run\'s last event, with the ledger\'s latest words', async () => {
    const fake = fakeLedger({ refusals: 5 })
    const unwritten = createUnwrittenAnswers({ ledger: fake.ledger, now: () => new Date('2026-10-04T12:05:00.000Z') })
    unwritten.remember('mission_1', approval, 'disk full')
    unwritten.remember('mission_1', { ...approval, approvalId: 'ap_2', kind: 'file-change', answer: 'denied' }, 'disk full')
    await unwritten.onRunEnded({ missionId: 'mission_1' })
    expect(fake.approvals).toEqual([])
    expect(fake.events.map((event) => [event.sequence, (event.payload as { message: string }).message])).toEqual([
      [8, 'The answer to a card (command, allowed) could not be written to this record: EBUSY: resource busy or locked'],
      [8, 'The answer to a card (file-change, denied) could not be written to this record: EBUSY: resource busy or locked']
    ])
    expect(fake.events[0]).toMatchObject({ runId: 'run_1', missionId: 'mission_1', sourceAdapter: 'codex', occurredAt: '2026-10-04T12:05:00.000Z', payload: { code: APPROVAL_NOT_RECORDED } })
  })

  it('reads the tail again when another writer took the sequence first', async () => {
    const fake = fakeLedger({ refusals: 5, tailTakenOnce: true })
    const unwritten = createUnwrittenAnswers({ ledger: fake.ledger })
    unwritten.remember('mission_1', approval, 'disk full')
    await unwritten.onRunEnded({ missionId: 'mission_1' })
    expect(fake.reads()).toBe(2)
    expect(fake.events.map((event) => event.sequence)).toEqual([9])
  })

  it('remembers nothing for a turn too old to hold cards, and touches a run with nothing remembered not at all (controls)', async () => {
    const fake = fakeLedger({ refusals: 5 })
    const unwritten = createUnwrittenAnswers({ ledger: fake.ledger })
    unwritten.remember('mission_old', approval, 'Mission ledger version cannot hold approvals')
    expect(unwritten.pending('mission_old')).toBe(0)
    await unwritten.onRunEnded({ missionId: 'mission_old' })
    await unwritten.onRunEnded({ missionId: 'mission_never' })
    expect(fake.reads()).toBe(0)
    expect(fake.approvals).toEqual([])
    expect(fake.events).toEqual([])
  })
})

describe('the host', () => {
  // The main process is not importable in a test; its wiring is read as text.
  const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('remembers a refused answer where every answer is written, and writes it when the run ends', () => {
    const recordAnswer = main.slice(main.indexOf('const recordAnswer = '), main.indexOf('const ruleContextOf = '))
    expect(recordAnswer).toContain('.appendApproval(request.missionId, approval)')
    expect(recordAnswer).toContain('unwrittenAnswers.remember(request.missionId, approval,')
    // A run-end step after the relay, which writes its own ending note first.
    expect(main).toContain("{ label: 'unwritten answers', step: () => unwrittenAnswers }")
  })
})
