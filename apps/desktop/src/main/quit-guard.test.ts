import { describe, expect, it } from 'vitest'

import { CLOSE_BUTTONS, closeQuestion, shouldAskBeforeClosing } from './quit-guard.js'

const moment = (over: Partial<Parameters<typeof shouldAskBeforeClosing>[0]> = {}) => ({
  liveRuns: 1,
  appQuitting: false,
  sessionEnding: false,
  confirmed: false,
  ...over
})

describe('closing the window while a teammate works asks first', () => {
  it('asks only when someone is working and the person is the one closing', () => {
    expect(shouldAskBeforeClosing(moment())).toBe(true)
    expect(shouldAskBeforeClosing(moment({ liveRuns: 0 }))).toBe(false)
  })

  it('never stands in the way of a quit already under way -- a relaunch, the updater', () => {
    expect(shouldAskBeforeClosing(moment({ appQuitting: true }))).toBe(false)
  })

  it('never holds up Windows shutting down or logging off', () => {
    expect(shouldAskBeforeClosing(moment({ sessionEnding: true }))).toBe(false)
  })

  it('asks once: "Quit anyway" closes', () => {
    expect(shouldAskBeforeClosing(moment({ confirmed: true }))).toBe(false)
  })

  it('names who is working, and says what quitting would do', () => {
    expect(closeQuestion(['Wren'], 1)).toEqual({
      message: 'Wren is still working.',
      detail: "If you quit now, the run stops. You can resume from the conversation when you're back."
    })
    expect(closeQuestion(['Wren', 'Sable'], 2).message).toBe('Wren and Sable are still working.')
    expect(closeQuestion(['Wren', 'Sable', 'Juno'], 3).message).toBe('Wren, Sable and Juno are still working.')
    expect(closeQuestion(['Wren', 'Wren'], 2).message).toBe('Wren is still working.')
    expect(closeQuestion([], 2)).toMatchObject({ message: '2 teammates are still working.', detail: expect.stringContaining('their runs stop') as unknown })
  })

  it('keeping the work going is the first button: the default, and what Escape does', () => {
    expect(CLOSE_BUTTONS[0]).toBe('Keep working')
  })
})
