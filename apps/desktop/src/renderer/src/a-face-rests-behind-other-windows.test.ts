import { afterEach, describe, expect, it, vi } from 'vitest'

import { startBotClock } from './components/Bot.js'
import type { BotFrames, BotPresence } from './components/Bot.js'

/**
 * A FACE RESTS BEHIND OTHER WINDOWS (0.611).
 *
 * Colin's Task Manager, 2026-10-04, with Locust behind it while Sonnet's
 * executor ran in it for 99 minutes: Locust's GPU process about 27 % of a
 * 12-core machine, its renderer 15 %. A window behind others is still
 * painted, so animation frames keep coming, and every moving face beside a
 * run was lit and drawn 30 times a second for nobody. The cover already
 * rested there (0.305); now every face's clock does.
 */

/** Animation frames a cancel really takes back, as the browser's are. */
function frames(): BotFrames & { fire: (at: number) => void; pending: () => number } {
  let queue = new Map<number, (now: number) => void>()
  let next = 1
  let time = 0
  return {
    requestAnimationFrame: (callback) => {
      const handle = next
      next += 1
      queue.set(handle, callback)
      return handle
    },
    cancelAnimationFrame: (handle) => {
      queue.delete(handle)
    },
    now: () => time,
    fire: (at) => {
      time = at
      const due = [...queue.values()]
      queue = new Map()
      due.forEach((callback) => callback(at))
    },
    pending: () => queue.size
  }
}

/** A window that can be sent behind others and brought back. */
function windowAt(away = false): BotPresence & { set: (next: boolean) => void; watchers: () => number } {
  let now = away
  const watchers = new Set<() => void>()
  return {
    away: () => now,
    watch: (changed) => {
      watchers.add(changed)
      return () => {
        watchers.delete(changed)
      }
    },
    set: (next) => {
      now = next
      for (const changed of [...watchers]) changed()
    },
    watchers: () => watchers.size
  }
}

describe('a moving face, while its window is behind other windows', () => {
  it('asks for no frames and draws nothing more, holding where it was', () => {
    const clock = frames()
    const window = windowAt()
    let drawn = 0
    const steps: number[] = []
    startBotClock(() => (drawn += 1), (seconds) => steps.push(seconds), () => true, clock, window)
    clock.fire(34)
    expect(drawn).toBe(2)
    window.set(true)
    expect(clock.pending()).toBe(0)
    clock.fire(5_000)
    clock.fire(9_000)
    expect(drawn).toBe(2)
    expect(steps).toEqual([0.034])
  })

  it('picks up when the window comes back, with no jump for the time it was away', () => {
    const clock = frames()
    const window = windowAt()
    let drawn = 0
    const steps: number[] = []
    startBotClock(() => (drawn += 1), (seconds) => steps.push(seconds), () => true, clock, window)
    clock.fire(34)
    window.set(true)
    clock.fire(5_000)
    window.set(false)
    expect(clock.pending()).toBe(1)
    clock.fire(5_034)
    expect(drawn).toBe(3)
    // The step after coming back is one frame's worth, not the five seconds it was away.
    expect(steps).toEqual([0.034, 0.034])
  })

  it('started behind other windows, is drawn once, and moves only once its window is in front', () => {
    const clock = frames()
    const window = windowAt(true)
    let drawn = 0
    startBotClock(() => (drawn += 1), () => undefined, () => true, clock, window)
    expect(drawn).toBe(1)
    expect(clock.pending()).toBe(0)
    window.set(false)
    expect(clock.pending()).toBe(1)
  })

  it('lets go of its window when it stops, and asks for nothing after', () => {
    const clock = frames()
    const window = windowAt()
    const stop = startBotClock(() => undefined, () => undefined, () => true, clock, window)
    expect(window.watchers()).toBe(1)
    stop()
    expect(window.watchers()).toBe(0)
    expect(clock.pending()).toBe(0)
    window.set(true)
    window.set(false)
    expect(clock.pending()).toBe(0)
  })
})

describe("the window's own presence", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  /** A window and document whose focus and visibility a test sets, and whose listeners it can fire. */
  function page(focused: boolean, hash = ''): { focused: boolean; hidden: boolean; fire: (name: string) => void; marked: () => boolean } {
    const listeners = new Map<string, () => void>()
    const attributes = new Set<string>()
    const state = { focused, hidden: false, fire: (name: string) => listeners.get(name)?.(), marked: () => attributes.has('data-away') }
    vi.stubGlobal('window', { location: { hash }, addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) })
    vi.stubGlobal('document', {
      get visibilityState() {
        return state.hidden ? 'hidden' : 'visible'
      },
      hasFocus: () => state.focused,
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      documentElement: {
        toggleAttribute: (name: string, on: boolean) => {
          if (on) attributes.add(name)
          else attributes.delete(name)
          return on
        }
      }
    })
    return state
  }

  it('is away on blur, back on focus, and away while hidden, telling every watcher each time', async () => {
    const shown = page(true)
    vi.resetModules()
    const { WINDOW_PRESENCE } = await import('./windowPresence.js')
    let told = 0
    WINDOW_PRESENCE.watch(() => (told += 1))
    expect(WINDOW_PRESENCE.away()).toBe(false)
    shown.focused = false
    shown.fire('blur')
    expect(WINDOW_PRESENCE.away()).toBe(true)
    shown.focused = true
    shown.fire('focus')
    expect(WINDOW_PRESENCE.away()).toBe(false)
    shown.hidden = true
    shown.fire('visibilitychange')
    expect(WINDOW_PRESENCE.away()).toBe(true)
    expect(told).toBe(3)
  })

  it('marks the root while it is away, which is what holds every CSS animation', async () => {
    const shown = page(true)
    vi.resetModules()
    const { watchWindowPresence } = await import('./windowPresence.js')
    watchWindowPresence()
    expect(shown.marked()).toBe(false)
    shown.fire('blur')
    expect(shown.marked()).toBe(true)
    shown.fire('focus')
    expect(shown.marked()).toBe(false)
  })

  it('reads the window as it is when first asked, so a focus change that came first is not missed', async () => {
    const shown = page(false)
    vi.resetModules()
    const { WINDOW_PRESENCE } = await import('./windowPresence.js')
    expect(WINDOW_PRESENCE.away()).toBe(true)
    expect(shown.marked()).toBe(true)
  })

  it('never holds the loading window: its motion says Locust is starting, focused or not', async () => {
    const shown = page(false, '#splash')
    vi.resetModules()
    const { WINDOW_PRESENCE } = await import('./windowPresence.js')
    expect(WINDOW_PRESENCE.away()).toBe(false)
    shown.fire('blur')
    expect(WINDOW_PRESENCE.away()).toBe(false)
    expect(shown.marked()).toBe(false)
  })

  it('is in front where there is no window at all, as in a server render', async () => {
    vi.resetModules()
    const { WINDOW_PRESENCE } = await import('./windowPresence.js')
    expect(WINDOW_PRESENCE.away()).toBe(false)
  })
})
