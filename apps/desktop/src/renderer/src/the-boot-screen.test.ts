import { describe, expect, it } from 'vitest'

import {
  applyDiscoveryEvent,
  bootView,
  emptyBoot,
  homeRelative,
  phaseAt,
  DISSOLVE_MS,
  SETTLE_DELAY_MS,
  SETTLE_MS,
  SETTLED_HOLD_MS,
  STALLED_AFTER_MS
} from './bootView.js'
import type { BootState } from './bootView.js'
import type { DiscoveryEvent } from '../../shared/ipc.js'

/**
 * The boot screen: a view of events, never of a timer.
 *
 * Colin, 2026-09-14: *"i just wanted something cool to keep the users
 * attention as the runtimes connect, sometimes it takes a while."* So the
 * screen has to be honest about a wait it did not cause and cannot shorten.
 * Everything drawn comes from real discovery events; the ONE invented
 * duration in the sequence is the 380ms beat before the settle, and a pause
 * is not a fabrication.
 */

const at = (kind: DiscoveryEvent['kind'], extra: Record<string, unknown> = {}): DiscoveryEvent =>
  ({ kind, ...extra }) as DiscoveryEvent

const fold = (events: readonly DiscoveryEvent[]): BootState =>
  events.reduce<BootState>((state, event) => applyDiscoveryEvent(state, event), emptyBoot)

describe('what the screen is made of', () => {
  it('draws one row per runtime, from the moment its command is issued', () => {
    const state = fold([
      at('started', { at: 0 }),
      at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 100 }),
      at('probe.started', { bin: 'claude', product: 'Claude Code', at: 600 })
    ])
    const view = bootView(state, 'probing', 900)
    expect(view.rows.map((row) => row.bin)).toEqual(['codex', 'claude'])
    // Neither has answered, so neither has a result -- that gap is the
    // whole reason this screen exists.
    expect(view.rows.every((row) => row.result === undefined)).toBe(true)
    expect(view.progress).toBe('checking 0 of 2 runtimes ')
  })

  it('counts elapsed from the moment the command was issued', () => {
    const state = fold([at('started', { at: 0 }), at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 100 })])
    expect(bootView(state, 'probing', 1_600).rows[0]?.elapsed).toBe('1.5s')
  })

  it('stops counting and says so once a probe has taken too long', () => {
    // A counter ticking past ten seconds stops being reassurance.
    const state = fold([at('started', { at: 0 }), at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 })])
    const view = bootView(state, 'probing', STALLED_AFTER_MS + 10)
    expect(view.rows[0]?.stalled).toBe(true)
    expect(view.showSkip).toBe(true)
  })

  it('offers no Skip until something has actually taken too long', () => {
    // A Skip from the first frame would be the screen apologising for
    // existing.
    const state = fold([at('started', { at: 0 }), at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 })])
    expect(bootView(state, 'probing', 500).showSkip).toBe(false)
  })

  it('never invents a summary before discovery has finished', () => {
    const state = fold([at('started', { at: 0 }), at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 })])
    expect(bootView(state, 'probing', 500).summary).toBe('')
  })

  it('says what was found, once there is something to say', () => {
    const state = fold([
      at('started', { at: 0 }),
      at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 }),
      at('probe.finished', { bin: 'codex', at: 400, outcome: 'ready', version: '0.153.0' }),
      at('finished', { at: 500, ready: 1, needsYou: 2 })
    ])
    const view = bootView(state, 'settled', 900)
    expect(view.rows[0]?.result).toBe('ready · 0.153.0')
    expect(view.summary).toContain('1 ready · 2 needs you')
    expect(view.summary).toContain('nothing pooled, proxied, or sent anywhere you have not connected')
  })

  it('does not claim a version it was never given', () => {
    const state = fold([
      at('started', { at: 0 }),
      at('probe.started', { bin: 'opencode', product: 'OpenCode', at: 0 }),
      at('probe.finished', { bin: 'opencode', at: 10, outcome: 'ready' })
    ])
    expect(bootView(state, 'settled', 20).rows[0]?.result).toBe('ready')
  })

  it('a second sweep is a new log, not more rows under the old one', () => {
    const state = fold([
      at('started', { at: 0 }),
      at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 }),
      at('started', { at: 900 }),
      at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 900 })
    ])
    expect(bootView(state, 'probing', 1_000).rows).toHaveLength(1)
  })
})

describe('the phases', () => {
  it('waits a beat before settling, so the screen does not flinch', () => {
    expect(phaseAt(0, SETTLE_DELAY_MS - 1)).toBe('probing')
    expect(phaseAt(0, SETTLE_DELAY_MS)).toBe('settling')
  })

  it('runs settling, settled, dissolving, then gone, in that order', () => {
    expect(phaseAt(0, SETTLE_DELAY_MS + SETTLE_MS - 1)).toBe('settling')
    expect(phaseAt(0, SETTLE_DELAY_MS + SETTLE_MS)).toBe('settled')
    expect(phaseAt(0, SETTLE_DELAY_MS + SETTLE_MS + SETTLED_HOLD_MS)).toBe('dissolving')
    expect(phaseAt(0, SETTLE_DELAY_MS + SETTLE_MS + SETTLED_HOLD_MS + DISSOLVE_MS)).toBe('gone')
  })

  it('has NO minimum dwell', () => {
    /*
     * If discovery takes 200ms the person sees a flash and is straight into
     * the app. That is the correct outcome and not a wasted one: the
     * animation is a way of ENDING a wait, never a reason to have one. A
     * screen that held itself open would be the app inventing a delay to
     * show a decoration.
     */
    const fast = fold([
      at('started', { at: 0 }),
      at('probe.started', { bin: 'codex', product: 'Codex CLI', at: 0 }),
      at('probe.finished', { bin: 'codex', at: 200, outcome: 'ready' }),
      at('finished', { at: 200, ready: 1, needsYou: 0 })
    ])
    expect(fast.finished?.at).toBe(200)
    // The whole sequence from a 200ms discovery is under two seconds.
    expect(SETTLE_DELAY_MS + SETTLE_MS + SETTLED_HOLD_MS + DISSOLVE_MS).toBeLessThan(2_000)
  })
})

describe('a path a person can read', () => {
  it('shortens a home path the way a terminal would', () => {
    const windows = ['C:', 'Users', '<home>', 'Documents', 'locust', 'mission-ledger'].join(String.fromCharCode(92))
    expect(homeRelative(windows)).toBe(['~', 'Documents', 'locust', 'mission-ledger'].join(String.fromCharCode(92)))
    expect(homeRelative('/home/colin/.locust/missions')).toBe('~/.locust/missions')
  })

  it('leaves a path it does not recognise exactly as it is', () => {
    // Inventing a shorter name for a path nobody can place is worse than a
    // long one: the point of the line is that it is the real location.
    expect(homeRelative('/var/lib/locust')).toBe('/var/lib/locust')
    expect(homeRelative('D:' + String.fromCharCode(92) + 'ledger')).toBe('D:' + String.fromCharCode(92) + 'ledger')
  })
})
