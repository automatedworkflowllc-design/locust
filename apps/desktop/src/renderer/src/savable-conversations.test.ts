import { describe, expect, it } from 'vitest'

import { savableConversations, savableMissionId, turnsLabel, SAVABLE_SHOWN } from './savableConversations.js'
import type { SavableConversation } from './savableConversations.js'

/**
 * The empty Routines screen offers the material, not a description of it.
 *
 * Colin had read the old empty state -- which named the right-click in prose
 * -- and still reported the feature as missing. The design agent's rule says
 * why: the entrance where the absence is felt must CONTAIN the entrance where
 * the material is, not describe it.
 */

const mission = (
  missionId: string,
  phase: string,
  lastAt: string | undefined,
  turns?: number
): SavableConversation => ({
  missionId,
  title: missionId,
  phase,
  ...(lastAt === undefined ? {} : { lastAt }),
  ...(turns === undefined ? {} : { turns })
})

describe('the conversations an empty Routines screen offers', () => {
  it('are the finished ones, newest first', () => {
    const found = savableConversations([
      mission('older', 'completed', '2026-09-08T10:00:00.000Z'),
      mission('newest', 'completed', '2026-09-09T10:00:00.000Z'),
      mission('middle', 'completed', '2026-09-09T09:00:00.000Z')
    ])
    expect(found.map((entry) => entry.missionId)).toEqual(['newest', 'middle', 'older'])
  })

  it('are never a run that failed, was cancelled, was interrupted or is still going', () => {
    // A routine is turns worth REPEATING. Offering to save a failed run would
    // be the screen recommending it, which is the same rule that keeps the
    // header button off those missions.
    const found = savableConversations([
      mission('ok', 'completed', '2026-09-09T10:00:00.000Z'),
      mission('failed', 'failed', '2026-09-09T11:00:00.000Z'),
      mission('cancelled', 'cancelled', '2026-09-09T11:00:00.000Z'),
      mission('interrupted', 'interrupted', '2026-09-09T11:00:00.000Z'),
      mission('running', 'running', '2026-09-09T11:00:00.000Z')
    ])
    expect(found.map((entry) => entry.missionId)).toEqual(['ok'])
  })

  it('are capped, so the empty state does not become a mission list', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      mission(`m${String(index)}`, 'completed', `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`)
    )
    expect(savableConversations(many)).toHaveLength(SAVABLE_SHOWN)
    expect(SAVABLE_SHOWN).toBe(4)
  })

  it('keep a conversation whose time is missing or unreadable, at the end', () => {
    // A row that exists and sorts oddly is a smaller problem than a row that
    // is silently absent.
    const found = savableConversations([
      mission('undated', 'completed', undefined),
      mission('nonsense', 'completed', 'not a date'),
      mission('dated', 'completed', '2026-09-09T10:00:00.000Z')
    ])
    expect(found[0]?.missionId).toBe('dated')
    expect(found).toHaveLength(3)
  })

  it('are empty when nothing has finished, so the screen can say so honestly', () => {
    expect(savableConversations([mission('running', 'running', '2026-09-09T10:00:00.000Z')])).toEqual([])
    expect(savableConversations([])).toEqual([])
  })

  it('count their turns in words that agree with themselves', () => {
    expect(turnsLabel(4)).toBe('4 turns')
    expect(turnsLabel(1)).toBe('1 turn')
    // An ordinary single-run mission records no turn count.
    expect(turnsLabel(undefined)).toBe('1 turn')
    expect(turnsLabel(0)).toBe('1 turn')
  })
})

/**
 * The header button, which is the entrance where the MATERIAL is.
 *
 * `Save as routine` lived only in a right-click. A menu is where you look
 * once you know an action exists; the header is how you find out. Both are
 * needed -- the header alone means being inside a finished mission and
 * looking up, the picker alone means already being on the screen.
 */
describe('the Save as routine button in the workroom header', () => {
  const shown = (over: Partial<Parameters<typeof savableMissionId>[0]> = {}) =>
    savableMissionId({ missionId: 'm1', phase: 'completed', running: false, hasDraft: true, ...over })

  it('is there on a finished conversation with turns of yours in it', () => {
    expect(shown()).toBe('m1')
  })

  it('is absent while the run is going', () => {
    // Chrome, not a nag: it appears when the work is done, and it does not
    // sit there through the run offering to save something unfinished.
    expect(shown({ running: true })).toBeUndefined()
  })

  it('is absent on a run that failed, was cancelled or was interrupted', () => {
    for (const phase of ['failed', 'cancelled', 'interrupted', 'running', undefined]) {
      expect(shown({ phase }), String(phase)).toBeUndefined()
    }
  })

  it('is absent when nothing in the conversation was typed by the person', () => {
    // A routine replays the turns YOU wrote. One with none has nothing to be.
    expect(shown({ hasDraft: false })).toBeUndefined()
  })

  it('is absent on a conversation whose first receipt has not landed', () => {
    // `pending:` ids are the shell's own placeholders and name no record.
    expect(shown({ missionId: 'pending:3' })).toBeUndefined()
    expect(shown({ missionId: undefined })).toBeUndefined()
  })
})
