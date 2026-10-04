import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileWorkroom } from '@teammate/mission-store'

import { retireSetAsideMessages } from './set-aside-messages.js'

/*
 * Sol's long pass on 0.509: a hand-off Builder posted in turns an edit later
 * set aside was still waiting 32 minutes on, and Reviewer's next run opened
 * on it. 0.512 retires such a message when the edit is sent.
 */
let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})
const open = async (): Promise<ReturnType<typeof createFileWorkroom>> => {
  root = await mkdtemp(join(tmpdir(), 'locust-set-aside-'))
  let ids = 0
  return createFileWorkroom({ rootDirectory: root, now: () => new Date('2026-09-30T21:00:00.000Z'), createId: () => `m${String(++ids)}` } as Parameters<typeof createFileWorkroom>[0])
}
const builder = (missionId: string) => ({ teammateId: 'tm_builder', name: 'Builder', missionId })
const reviewer = { teammateId: 'tm_reviewer', name: 'Reviewer' }

describe('what a set-aside turn sent, nobody gets', () => {
  it('a message the set-aside turns sent, still unread, is never handed to its recipient', async () => {
    const workroom = await open()
    const stale = await workroom.post({ from: builder('mission_json_5'), to: reviewer, text: 'Rewrite the README for JSON storage.' })
    const kept = await workroom.post({ from: builder('mission_2'), to: reviewer, text: 'The tests live in test/.' })
    expect(await retireSetAsideMessages(workroom, ['mission_json_4', 'mission_json_5'])).toEqual([stale.messageId])
    const waiting = await workroom.unread('tm_reviewer', 10)
    expect(waiting.messages.map((message) => message.text)).toEqual(['The tests live in test/.'])
    // Recorded as back with the turn that sent it, and the file still reads whole.
    const snapshot = await workroom.read()
    expect(snapshot.deliveries).toEqual([expect.objectContaining({ messageId: stale.messageId, missionId: 'mission_json_5' })])
    expect(snapshot.issues).toEqual([])
    expect(kept.messageId).not.toBe(stale.messageId)
  })

  it('a message already delivered stays as it was, and nothing else is touched', async () => {
    const workroom = await open()
    const read = await workroom.post({ from: builder('mission_json_5'), to: reviewer, text: 'Already read.' })
    await workroom.markDelivered([read.messageId], 'mission_reviewer_1')
    expect(await retireSetAsideMessages(workroom, ['mission_json_5'])).toEqual([])
    expect((await workroom.read()).deliveries).toEqual([expect.objectContaining({ messageId: read.messageId, missionId: 'mission_reviewer_1' })])
  })

  it('the window names the turns an edit sets aside, and the host retires them only on an edit partway through', async () => {
    const { readFileSync } = await import('node:fs')
    const app = readFileSync(new URL('../renderer/src/App.tsx', import.meta.url), 'utf8')
    const host = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(app).toContain('setAside: turns.slice(index).map((turn) => turn.missionId),')
    expect(app).toContain('rewind: { tip: rewind.tip, ...(rewind.setAside === undefined ? {} : { setAside: rewind.setAside }) }')
    // Editing the FIRST message keeps the old conversation; nothing of it is retired.
    expect(host).toContain('if (rewindTip(payload) !== undefined && followUpOf !== undefined) await retireSetAside(payload)')
  })

  it('ignores a list that is not one', async () => {
    const workroom = await open()
    await workroom.post({ from: builder('mission_json_5'), to: reviewer, text: 'Waiting.' })
    for (const listed of [undefined, 'mission_json_5', [], [42], ['../etc'], new Array(501).fill('mission_json_5')]) {
      expect(await retireSetAsideMessages(workroom, listed)).toEqual([])
    }
    expect((await workroom.unread('tm_reviewer', 10)).messages).toHaveLength(1)
  })
})
