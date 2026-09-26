import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UPDATE_CHECK_EVERY_MS, UPDATE_RETRY_AFTER_RUN_MS, createUpdateService, periodicCheckDue } from './updates.js'
import type { UpdaterLike } from './updates.js'

/**
 * AN OPEN LOCUST KEEPS LOOKING FOR UPDATES (C2, 0.367).
 *
 * It looked once, eight seconds after launch (known issue 5), so a person
 * who keeps the app open for days never heard of a release until they
 * restarted it. Now it looks every six hours -- never while a teammate is
 * working, and never while a version is already found or on its way.
 */
function updater(checks: { count: number }): UpdaterLike {
  return {
    autoDownload: false,
    allowPrerelease: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => {
      checks.count += 1
      return null
    },
    downloadUpdate: async () => undefined,
    quitAndInstall: () => undefined,
    on() {
      return this
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a Locust left open', () => {
  it('looks again every six hours', async () => {
    const checks = { count: 0 }
    const service = createUpdateService({ updater: updater(checks), currentVersion: '0.366.0', supported: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    const stop = service.startPeriodicChecks()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS - 1)
    expect(checks.count).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(checks.count).toBe(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS)
    expect(checks.count).toBe(2)
    stop()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS * 3)
    expect(checks.count).toBe(2)
  })

  it('waits while a teammate is working, and tries again soon rather than six hours later', async () => {
    const checks = { count: 0 }
    let live = 1
    const service = createUpdateService({ updater: updater(checks), currentVersion: '0.366.0', supported: true, liveMissionCount: () => live, requestQuit: () => undefined })
    service.startPeriodicChecks()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS)
    expect(checks.count).toBe(0)
    live = 0
    await vi.advanceTimersByTimeAsync(UPDATE_RETRY_AFTER_RUN_MS)
    expect(checks.count).toBe(1)
  })

  it('never looks in a build that cannot update itself', async () => {
    const checks = { count: 0 }
    const service = createUpdateService({ updater: updater(checks), currentVersion: '0.366.0', supported: false, liveMissionCount: () => 0, requestQuit: () => undefined })
    service.startPeriodicChecks()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS * 2)
    expect(checks.count).toBe(0)
  })
})

describe('whether a periodic look is due', () => {
  it('is, when nothing is found yet or the last look could not complete', () => {
    for (const phase of ['idle', 'current', 'failed'] as const) expect(periodicCheckDue({ phase, currentVersion: '0.366.0' }, 0)).toBe(true)
  })

  it('is not while a check runs, or a version is found, coming down, or waiting to install -- or while a teammate works', () => {
    for (const phase of ['checking', 'available', 'downloading', 'ready', 'unsupported'] as const) {
      expect(periodicCheckDue({ phase, currentVersion: '0.366.0' }, 0)).toBe(false)
    }
    expect(periodicCheckDue({ phase: 'current', currentVersion: '0.366.0' }, 2)).toBe(false)
  })
})
