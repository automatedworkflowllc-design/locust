import { afterEach, describe, expect, it } from 'vitest'

import { cursorConnectorsNeedingLogin, forgetCursorConnectorReading } from './cursor-connector-notice.js'

/**
 * A B4 lead from the code review, settled: a `cursor-agent mcp list` that
 * failed or timed out came back as an empty reading, and an empty reading
 * was kept for five minutes -- so a login-needed connector went unmentioned
 * for five minutes after one slow answer, though the code said failures are
 * not cached.
 */
afterEach(() => forgetCursorConnectorReading())

describe('a Cursor connector reading that failed', () => {
  it('is not kept: the next run asks again', async () => {
    let calls = 0
    const lister = async (): Promise<string | undefined> => {
      calls += 1
      return calls === 1 ? undefined : 'notion: needs login'
    }
    await cursorConnectorsNeedingLogin(lister, () => 1_000)
    await cursorConnectorsNeedingLogin(lister, () => 2_000)
    expect(calls).toBe(2)
  })
})
