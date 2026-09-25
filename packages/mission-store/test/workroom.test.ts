import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFileWorkroom, MAX_WORKROOM_MESSAGE_LENGTH, WORKROOM_SCHEMA_VERSION } from '../src/index.js'
import type { Workroom } from '../src/index.js'

const NOW = '2026-09-01T16:00:00.000Z'
const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'teammate-workroom-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas' }
const WREN = { teammateId: 'tm_wren', name: 'Wren' }

function workroomAt(root: string): Workroom {
  let nextId = 0
  return createFileWorkroom({
    rootDirectory: root,
    now: () => new Date(NOW),
    createId: () => `id${++nextId}`
  })
}

function postFromAtlas(workroom: Workroom, text: string, missionId = 'mission_a1') {
  return workroom.post({ from: { ...ATLAS, missionId }, to: WREN, text })
}

describe('the workroom channel', () => {
  it('records an attributed, routed message and reads it back', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const posted = await postFromAtlas(workroom, 'The build runs through pnpm check.')
    expect(posted).toEqual({
      messageId: 'wm_id1',
      sequence: 1,
      from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a1' },
      to: { teammateId: 'tm_wren', name: 'Wren' },
      text: 'The build runs through pnpm check.',
      postedAt: NOW
    })
    const snapshot = await workroom.read()
    expect(snapshot.issues).toEqual([])
    expect(snapshot.messages).toEqual([posted])
  })

  it('shows a message to its recipient once, and never to anyone else', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const first = await postFromAtlas(workroom, 'first')
    const second = await postFromAtlas(workroom, 'second')
    await expect(workroom.unread('tm_atlas', 10)).resolves.toEqual({ messages: [], remaining: 0 })
    await expect(workroom.unread('tm_wren', 10)).resolves.toEqual({
      messages: [first, second],
      remaining: 0
    })
    await workroom.markDelivered([first.messageId], 'mission_w1')
    await expect(workroom.unread('tm_wren', 10)).resolves.toEqual({ messages: [second], remaining: 0 })
    const snapshot = await workroom.read()
    expect(snapshot.deliveries).toEqual([
      { messageId: first.messageId, missionId: 'mission_w1', deliveredAt: NOW }
    ])
  })

  it('bounds a delivery batch oldest-first and says how many are still waiting', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const first = await postFromAtlas(workroom, 'one')
    await postFromAtlas(workroom, 'two')
    await postFromAtlas(workroom, 'three')
    await expect(workroom.unread('tm_wren', 1)).resolves.toEqual({ messages: [first], remaining: 2 })
  })

  it('refuses to deliver the same message twice', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const message = await postFromAtlas(workroom, 'once')
    await workroom.markDelivered([message.messageId], 'mission_w1')
    await expect(workroom.markDelivered([message.messageId], 'mission_w2')).rejects.toThrow(
      'already delivered'
    )
    await expect(workroom.markDelivered(['wm_nope'], 'mission_w2')).rejects.toThrow('Unknown workroom message')
  })

  it('posts the same words from the same run to the same teammate once (A2.2)', async () => {
    // A re-read, a retry, a restart part-way through posting, or a model
    // that wrote one block twice must not deliver twice: each delivery can
    // start a run.
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const first = await postFromAtlas(workroom, 'The build runs through pnpm check.')
    const again = await postFromAtlas(workroom, 'The build runs through pnpm check.')
    expect(again).toEqual(first)
    expect((await workroom.read()).messages).toEqual([first])
    // Different words, or the same words from a later run, are new messages.
    await postFromAtlas(workroom, 'Also: pnpm lint.')
    await postFromAtlas(workroom, 'The build runs through pnpm check.', 'mission_a2')
    expect((await workroom.read()).messages).toHaveLength(3)
    expect((await workroomAt(root).unread('tm_wren', 10)).messages).toHaveLength(3)
  })

  it('refuses a self-addressed message, an oversized one, and control characters', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    await expect(
      workroom.post({ from: { ...ATLAS, missionId: 'mission_a1' }, to: ATLAS, text: 'note to self' })
    ).rejects.toThrow('cannot message itself')
    await expect(postFromAtlas(workroom, 'x'.repeat(MAX_WORKROOM_MESSAGE_LENGTH + 1))).rejects.toThrow(
      'text is invalid'
    )
    await expect(postFromAtlas(workroom, 'bell\u0007')).rejects.toThrow('text is invalid')
    await expect(postFromAtlas(workroom, '   ')).rejects.toThrow('text is invalid')
    // Line breaks are text, not control characters.
    await expect(postFromAtlas(workroom, 'line one\nline two')).resolves.toMatchObject({
      text: 'line one\nline two'
    })
  })

  it('tolerates a truncated tail and reports it, keeping every complete record', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const kept = await postFromAtlas(workroom, 'kept')
    await appendFile(join(root, 'workroom.jsonl'), '{"schemaVersion":1,"recordType":"workroom.message","sequ')
    const snapshot = await workroom.read()
    expect(snapshot.messages).toEqual([kept])
    expect(snapshot.issues.map((entry) => entry.code)).toEqual(['truncated-tail'])
  })

  /*
   * L9 (the code review): a torn last line -- a crash or a power cut in the
   * middle of an append -- disabled the workroom for good: every post and
   * every read of what is waiting threw, in every folder, until someone
   * hand-edited a file in AppData. A torn TAIL is repaired: the file goes
   * back to its last complete record. A record that breaks the sequence is
   * still refused (below): that is not a crash, and nothing guesses past it.
   */
  it('repairs a torn tail and carries on', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const kept = await postFromAtlas(workroom, 'kept')
    await appendFile(join(root, 'workroom.jsonl'), '{"schemaVersion":1,"recordType":"workroom.message","sequ')
    const next = await postFromAtlas(workroom, 'after the crash', 'mission_a2')
    const unread = await workroom.unread(WREN.teammateId, 10)
    expect(unread.messages.map((message) => message.text)).toEqual(['kept', 'after the crash'])
    const snapshot = await workroom.read()
    expect(snapshot.issues).toEqual([])
    expect(snapshot.messages).toEqual([kept, next])
  })

  it('stops at a record that breaks the sequence, and refuses to append past the break', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const kept = await postFromAtlas(workroom, 'kept')
    const forged = JSON.stringify({
      schemaVersion: WORKROOM_SCHEMA_VERSION,
      recordType: 'workroom.message',
      sequence: 7,
      occurredAt: NOW,
      message: { ...kept, sequence: undefined }
    })
    await appendFile(join(root, 'workroom.jsonl'), `${forged}\n`)
    const snapshot = await workroom.read()
    expect(snapshot.messages).toEqual([kept])
    expect(snapshot.issues.map((entry) => entry.code)).toEqual(['invalid-record'])
    await expect(postFromAtlas(workroom, 'after the break')).rejects.toThrow('Workroom is unavailable')
  })

  it('refuses a self-addressed record on read, not only on write', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    // The writer refuses these too, so this plants one by hand: a reader that
    // trusted the writer would deliver it to its own author as a colleague's
    // claim.
    await writeFile(
      join(root, 'workroom.jsonl'),
      `${JSON.stringify({
        schemaVersion: WORKROOM_SCHEMA_VERSION,
        recordType: 'workroom.message',
        sequence: 1,
        occurredAt: NOW,
        message: {
          messageId: 'wm_self',
          from: { ...ATLAS, missionId: 'mission_a1' },
          to: ATLAS,
          text: 'note to self',
          postedAt: NOW
        }
      })}
`
    )
    const snapshot = await workroom.read()
    expect(snapshot.messages).toEqual([])
    expect(snapshot.issues.map((entry) => entry.code)).toEqual(['invalid-record'])
    await expect(workroom.unread('tm_atlas', 5)).rejects.toThrow('Workroom is unavailable')
  })

  it('refuses a delivery record for a message the file does not hold', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    await writeFile(
      join(root, 'workroom.jsonl'),
      `${JSON.stringify({
        schemaVersion: WORKROOM_SCHEMA_VERSION,
        recordType: 'workroom.delivery',
        sequence: 1,
        occurredAt: NOW,
        delivery: { messageId: 'wm_ghost', missionId: 'mission_w1', deliveredAt: NOW }
      })}\n`
    )
    const snapshot = await workroom.read()
    expect(snapshot.deliveries).toEqual([])
    expect(snapshot.issues.map((entry) => entry.code)).toEqual(['invalid-record'])
  })

  it('refuses a schema it does not know rather than guessing at it', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    await writeFile(
      join(root, 'workroom.jsonl'),
      `${JSON.stringify({ schemaVersion: WORKROOM_SCHEMA_VERSION + 1, recordType: 'workroom.message', sequence: 1, occurredAt: NOW, message: {} })}\n`
    )
    const snapshot = await workroom.read()
    expect(snapshot.issues.map((entry) => entry.code)).toEqual(['unsupported-schema'])
  })

  it('writes each record with a version, a sequence and an fsynced line', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    const message = await postFromAtlas(workroom, 'durable')
    await workroom.markDelivered([message.messageId], 'mission_w1')
    const lines = (await readFile(join(root, 'workroom.jsonl'), 'utf8')).trimEnd().split('\n')
    expect(lines.map((line) => JSON.parse(line) as { recordType: string; sequence: number; schemaVersion: number }))
      .toEqual([
        expect.objectContaining({ recordType: 'workroom.message', sequence: 1, schemaVersion: 1 }),
        expect.objectContaining({ recordType: 'workroom.delivery', sequence: 2, schemaVersion: 1 })
      ])
  })

  it('reads as empty, not as broken, before anyone has posted', async () => {
    const root = await temporaryRoot()
    const workroom = workroomAt(root)
    await expect(workroom.read()).resolves.toEqual({ messages: [], deliveries: [], issues: [] })
    await expect(workroom.unread('tm_wren', 5)).resolves.toEqual({ messages: [], remaining: 0 })
  })
})
