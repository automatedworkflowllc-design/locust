import { describe, expect, it } from 'vitest'

import { fittedTaskSection, taskSection } from './room-task.js'
import type { TaskBoardLine } from './room-task.js'

/**
 * A LONG ROOM POST STILL STARTS.
 *
 * A post may be 8,000 characters and a mission prompt may be 8,000
 * characters, and the board was appended to the post: over the limit, and
 * every member refused (harness review, 2026-09-24). The post goes whole; the
 * board gives way and says what it left out.
 */
const LIMIT = 8_000
const rows = (count: number, state: TaskBoardLine['state'] = 'open'): TaskBoardLine[] =>
  Array.from({ length: count }, (_, index) => ({ text: `Task number ${String(index + 1)} with some words to it`, state, ownerName: undefined }))
const room = { roomName: 'Release', selfName: 'Wren', memberNames: ['Wren', 'Booty'] }

describe('the board beside a post', () => {
  it('is the whole board when it fits', () => {
    const tasks = rows(3)
    expect(fittedTaskSection({ ...room, tasks, budget: LIMIT })).toBe(taskSection({ ...room, tasks }))
  })

  it('fits under the limit beside a long post, done rows going first, and says how many it left out', () => {
    const post = 'x'.repeat(6_500)
    const tasks = [...rows(10, 'done'), ...rows(20)]
    const budget = LIMIT - post.length - 2
    expect(taskSection({ ...room, tasks }).length).toBeGreaterThan(budget)
    const fitted = fittedTaskSection({ ...room, tasks, budget })
    expect(fitted.length).toBeLessThanOrEqual(budget)
    expect(fitted).not.toContain('[done]')
    expect(fitted).toMatch(/\d+ more rows? on the board did not fit beside this post\./)
    expect(`${post}\n\n${fitted}`.length).toBeLessThanOrEqual(LIMIT)
  })

  it('says so, briefly, when even the board’s instructions do not fit', () => {
    const fitted = fittedTaskSection({ ...room, tasks: rows(5), budget: 120 })
    expect(fitted).toBe('The room’s task board did not fit beside this post.')
  })

  it('is nothing at all when there is no room for even that', () => {
    expect(fittedTaskSection({ ...room, tasks: rows(5), budget: 10 })).toBe('')
  })
})
