import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Run the hook's effects without a DOM renderer; browser events and timers remain real seams.
const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], states: [] as boolean[] }))
vi.mock('react', () => ({
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: () => boolean) => {
    const index = hooks.states.push(initial()) - 1
    return [hooks.states[index], (next: boolean) => { hooks.states[index] = next }]
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect) }
}))

import { COVER_REST_AFTER_MS, useCoverActivity } from './useCoverActivity.js'

let win: EventTarget
let doc: EventTarget
let motion: EventTarget & { matches: boolean }
let focused: boolean
let hidden: boolean
const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  focused = true
  hidden = false
  win = new EventTarget()
  doc = new EventTarget()
  motion = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('window', Object.assign(win, { setTimeout, clearTimeout, matchMedia: () => motion }))
  vi.stubGlobal('document', Object.assign(doc, { hasFocus: () => focused, get hidden() { return hidden } }))
  // Object.assign reads accessors, so keep hidden live as the browser does.
  Object.defineProperty(doc, 'hidden', { get: () => hidden })
  hooks.effects.length = 0
  hooks.states.length = 0
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function mount(): ReturnType<typeof useCoverActivity> {
  const hook = useCoverActivity('first work')
  for (const effect of hooks.effects) {
    const stop = effect()
    if (stop !== undefined) cleanups.push(stop)
  }
  return hook
}

describe('the Home activity hook', () => {
  it('pauses at 45 seconds, with no polling or timers left while resting', () => {
    const hook = mount()
    expect(COVER_REST_AFTER_MS).toBe(45_000)
    vi.advanceTimersByTime(44_999)
    expect(hook.presence.away()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(hooks.states[0]).toBe(true)
    expect(hook.presence.away()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus'])('%s resumes synchronously and resets the deadline', (event) => {
    const hook = mount()
    vi.advanceTimersByTime(45_000)
    win.dispatchEvent(new Event(event))
    expect(hook.presence.away()).toBe(false)
    expect(hooks.states[0]).toBe(false)
    vi.advanceTimersByTime(44_999)
    expect(hook.presence.away()).toBe(false)
  })

  it('stream arrival resumes and extends the deadline without a change to the status words', () => {
    const hook = mount()
    vi.advanceTimersByTime(45_000)
    hooks.effects[1]() // The hook's effect for a new activity identity.
    expect(hook.presence.away()).toBe(false)
    vi.advanceTimersByTime(44_000)
    hooks.effects[1]()
    vi.advanceTimersByTime(2_000)
    expect(hook.presence.away()).toBe(false)
    vi.advanceTimersByTime(43_000)
    expect(hook.presence.away()).toBe(true)
  })

  it('blur and hiding pause immediately, work cannot wake a window nobody sees', () => {
    const hook = mount()
    focused = false
    win.dispatchEvent(new Event('blur'))
    hooks.effects[1]()
    expect(hook.presence.away()).toBe(true)
    focused = true
    win.dispatchEvent(new Event('focus'))
    expect(hook.presence.away()).toBe(false)
    hidden = true
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('pointermove'))
    expect(hook.presence.away()).toBe(true)
    hidden = false
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(hook.presence.away()).toBe(false)
  })

  it('reduced motion never animates despite input, focus or a stream, and follows preference changes', () => {
    motion.matches = true
    const hook = mount()
    for (const event of ['pointermove', 'keydown', 'focus']) win.dispatchEvent(new Event(event))
    hooks.effects[1]()
    expect(hook.presence.away()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    motion.matches = false
    motion.dispatchEvent(new Event('change'))
    expect(hook.presence.away()).toBe(false)
    motion.matches = true
    motion.dispatchEvent(new Event('change'))
    expect(hook.presence.away()).toBe(true)
  })

  it('notifies canvas clocks on pause and resume and removes listeners on unmount', () => {
    const hook = mount()
    const changed = vi.fn()
    const unwatch = hook.presence.watch(changed)
    vi.advanceTimersByTime(45_000)
    expect(changed).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event('keydown'))
    expect(changed).toHaveBeenCalledTimes(2)
    unwatch()
    cleanups.splice(0).forEach((stop) => stop())
    win.dispatchEvent(new Event('blur'))
    expect(hook.presence.away()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
