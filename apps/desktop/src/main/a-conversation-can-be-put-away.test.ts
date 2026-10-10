import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore } from './teammate-store.js'

/*
 * SETTLE AND SNOOZE (0.730): what was put away is kept beside the pins and names, so it stays put away after a
 * restart, and comes back when brought back. The sidebar's side is a-conversation-can-be-put-away.test.tsx.
 */
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })))
})
const folder = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'locust-settled-'))
  roots.push(root)
  return root
}

describe('putting a conversation away', () => {
  it('keeps a settle and a snooze, after Locust opens again, until it is brought back', async () => {
    const root = await folder()
    const teammates = createTeammateStore({ rootDirectory: root })
    await teammates.settleMission('m_1', {})
    await teammates.settleMission('m_2', { until: '2026-10-11T13:00:00.000Z' })
    const again = await createTeammateStore({ rootDirectory: root }).missionSettled()
    expect(Object.keys(again).sort()).toEqual(['m_1', 'm_2'])
    expect(again.m_1!.until).toBeUndefined()
    expect(again.m_2!.until).toBe('2026-10-11T13:00:00.000Z')
    expect(Number.isNaN(Date.parse(again.m_1!.at))).toBe(false)
    await teammates.settleMission('m_1', undefined)
    expect(Object.keys(await teammates.missionSettled())).toEqual(['m_2'])
  })

  it('takes no id it would not take for a name, and no time that is not one', async () => {
    const teammates = createTeammateStore({ rootDirectory: await folder() })
    await expect(teammates.settleMission('../escape', {})).rejects.toThrow()
    await expect(teammates.settleMission('m_1', { until: 'tomorrow-ish' })).rejects.toThrow()
  })
})
