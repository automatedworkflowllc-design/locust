import { describe, expect, it } from 'vitest'

import { CLOSE_BUTTONS, closeQuestion, shouldAskBeforeClosing, trayLine } from './quit-guard.js'

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

  it('names who is working, and says what each answer does', () => {
    expect(closeQuestion(['Wren'], 1)).toEqual({
      message: 'Wren is still working.',
      detail: "Keep them working and Locust closes to the tray until you open it again, with a notification when they finish. If you quit now, the run stops; you can resume from the conversation when you're back."
    })
    expect(closeQuestion(['Wren', 'Sable'], 2).message).toBe('Wren and Sable are still working.')
    expect(closeQuestion(['Wren', 'Sable', 'Juno'], 3).message).toBe('Wren, Sable and Juno are still working.')
    expect(closeQuestion(['Wren', 'Wren'], 2).message).toBe('Wren is still working.')
    expect(closeQuestion([], 2)).toMatchObject({ message: '2 teammates are still working.', detail: expect.stringContaining('their runs stop') as unknown })
  })

  it('keeping the work going is the first button and the default; Cancel leaves the window open (0.397)', () => {
    expect(CLOSE_BUTTONS).toEqual(['Keep working in the background', 'Quit anyway', 'Cancel'])
  })

  it('the tray says who is working while the window is closed, and when nobody is', () => {
    expect(trayLine(['Wren'], 1)).toBe('Locust: Wren is working.')
    expect(trayLine(['Wren', 'Sable'], 2)).toBe('Locust: Wren and Sable are working.')
    expect(trayLine([], 3)).toBe('Locust: 3 teammates are working.')
    expect(trayLine([], 0)).toBe('Locust: nobody is working. Click to open.')
  })
})
