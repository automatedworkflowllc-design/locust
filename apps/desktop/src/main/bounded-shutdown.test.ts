import { describe, expect, it } from 'vitest'

import { boundedShutdown } from './bounded-shutdown.js'

/**
 * The control this file exists for: a quit that never finishes must still
 * end. Before this, a runtime whose child process ignored the kill left the
 * shutdown awaiting a promise that would never settle, and the folder switch
 * -- which quits in order to reopen -- reported itself as the app closing.
 */
describe('a bounded shutdown', () => {
  it('leaves on its own when the work never settles', async () => {
    const reasons: string[] = []
    boundedShutdown({
      // The real shape of the hang: a promise with no resolver.
      work: () => new Promise<void>(() => undefined),
      deadlineMs: 5,
      leave: (reason) => reasons.push(reason),
      failed: () => reasons.push('failed')
    })
    expect(reasons).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(reasons).toEqual(['deadline'])
  })

  it('leaves as soon as the work is done, and not again at the deadline', async () => {
    const reasons: string[] = []
    boundedShutdown({
      work: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
      },
      deadlineMs: 20,
      leave: (reason) => reasons.push(reason),
      failed: () => reasons.push('failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(reasons).toEqual(['finished'])
  })

  it('reports a failed flush as a failure rather than as a clean exit', async () => {
    const seen: unknown[] = []
    const reasons: string[] = []
    boundedShutdown({
      work: () => Promise.reject(new Error('the ledger could not be written')),
      deadlineMs: 20,
      leave: (reason) => reasons.push(reason),
      failed: (error) => seen.push(error)
    })
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(reasons).toEqual([])
    expect(seen).toHaveLength(1)
    expect((seen[0] as Error).message).toContain('ledger')
  })

  it('does not leave twice when the work lands right after the deadline', async () => {
    const reasons: string[] = []
    let release = (): void => undefined
    boundedShutdown({
      work: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
      deadlineMs: 5,
      leave: (reason) => reasons.push(reason),
      failed: () => reasons.push('failed')
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(reasons).toEqual(['deadline'])
  })
})
