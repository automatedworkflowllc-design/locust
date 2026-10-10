import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore, MAX_MISSION_PINS } from './teammate-store.js'

/*
 * A CONVERSATION CAN BE PINNED (0.729): the pins are kept with the names people give conversations, so they come
 * back after a restart. The sidebar's side is a-conversation-can-be-pinned.test.tsx in the renderer.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
})
const folder = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-pins-'))
  roots.push(root)
  return root
}

describe('pinning a conversation', () => {
  it('is kept, newest pin first, and still there after Locust opens again', async () => {
    const root = await folder()
    const teammates = createTeammateStore({ rootDirectory: root })
    await teammates.pinMission('m_1', true)
    await teammates.pinMission('m_2', true)
    await teammates.pinMission('m_1', true)
    expect(await teammates.missionPins()).toEqual(['m_1', 'm_2'])
    await teammates.pinMission('m_2', false)
    expect(await createTeammateStore({ rootDirectory: root }).missionPins()).toEqual(['m_1'])
  })

  it('takes no id it would not take for a name, and stops at the cap with a reason', async () => {
    const teammates = createTeammateStore({ rootDirectory: await folder() })
    await expect(teammates.pinMission('../escape', true)).rejects.toThrow()
    for (let at = 0; at < MAX_MISSION_PINS; at += 1) await teammates.pinMission(`m_${String(at)}`, true)
    await expect(teammates.pinMission('m_one_more', true)).rejects.toThrow(/At most 50/)
    // Unpinning one at the cap still works, and makes room.
    await teammates.pinMission('m_0', false)
    await teammates.pinMission('m_one_more', true)
    expect((await teammates.missionPins())[0]).toBe('m_one_more')
  })
})
