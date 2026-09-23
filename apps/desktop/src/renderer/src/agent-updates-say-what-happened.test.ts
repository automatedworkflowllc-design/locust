import { describe, expect, it } from 'vitest'

import { keepCurrentNote, updateLine } from './agentUpdates.js'
import type { RuntimeUpdateView } from '../../shared/ipc.js'

/**
 * WHAT A RUNTIME'S ROW SAYS ABOUT KEEPING IT CURRENT: one line, only when
 * there is something to say (main/runtime-updates.ts has the rules).
 */
const view = (status: RuntimeUpdateView['status']): RuntimeUpdateView => ({ runtime: 'codex', installed: '0.153.0', latest: '0.156.1', status })
const NOW = new Date('2026-09-24T12:00:00')

describe("a runtime's row", () => {
  it('says nothing when the agent is current', () => {
    expect(updateLine(view({ kind: 'current' }), NOW)).toBeUndefined()
    expect(updateLine(undefined, NOW)).toBeUndefined()
  })

  it('says a newer version is out, and what it is waiting for', () => {
    expect(updateLine(view({ kind: 'waiting', version: '0.156.1', why: 'in use' }), NOW)).toBe('0.156.1 is out. It updates once nothing is using it.')
    expect(updateLine(view({ kind: 'waiting', version: '0.156.1', why: 'too new' }), NOW)).toBe('0.156.1 is out. It updates once it has been out 12 hours.')
    expect(updateLine(view({ kind: 'waiting', version: '0.156.1', why: 'off' }), NOW)).toBe('0.156.1 is out. Keeping it current is off.')
  })

  it('says an update is under way, landed, or failed -- and when', () => {
    expect(updateLine(view({ kind: 'updating', version: '0.156.1' }), NOW)).toBe('Updating to 0.156.1…')
    expect(updateLine(view({ kind: 'updated', from: '0.153.0', to: '0.156.1', at: '2026-09-24T11:05:00' }), NOW)).toMatch(/^Updated from 0\.153\.0 to 0\.156\.1 at 11:05/)
    expect(updateLine(view({ kind: 'updated', from: '0.153.0', to: '0.156.1', at: '2026-09-22T11:05:00' }), NOW)).toMatch(/^Updated from 0\.153\.0 to 0\.156\.1 on Sep 22/)
    expect(updateLine(view({ kind: 'failed', version: '0.156.1', what: 'npm could not replace the files.', at: '2026-09-24T11:05:00' }), NOW)).toMatch(/^Could not update to 0\.156\.1 at 11:05.*: npm could not replace the files\.$/)
  })
})

it('the switch says what it does either way', () => {
  expect(keepCurrentNote(true)).toMatch(/^On\. Codex CLI and Copilot CLI are updated/)
  expect(keepCurrentNote(false)).toMatch(/^Off\./)
})
