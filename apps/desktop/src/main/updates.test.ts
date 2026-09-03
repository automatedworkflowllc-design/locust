import { describe, expect, it, vi } from 'vitest'

import { createUpdateService } from './updates.js'
import type { UpdaterLike } from './updates.js'

function fakeUpdater(overrides: Partial<UpdaterLike> = {}): UpdaterLike & {
  readonly listeners: Map<string, (payload?: unknown) => void>
  readonly installs: number[]
} {
  const listeners = new Map<string, (payload?: unknown) => void>()
  const installs: number[] = []
  return {
    listeners,
    installs,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => null,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => {
      installs.push(1)
    },
    on(event: string, listener: (payload?: unknown) => void) {
      listeners.set(event, listener)
      return this
    },
    ...overrides
  }
}

describe('what the app does about a new version', () => {
  it('downloads on its own, and never installs on its own', () => {
    const updater = fakeUpdater()
    createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })
    // Downloading is quiet and safe. Installing swaps the binary and restarts,
    // which must never happen while nobody is watching -- including at quit,
    // which is just someone closing a window.
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('refuses to install while a mission is running, and says why', () => {
    const updater = fakeUpdater({
      checkForUpdates: async () => ({ updateInfo: { version: '0.6.0' } })
    })
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 1
    })
    updater.listeners.get('update-downloaded')?.()

    const response = service.install()

    expect(response).toMatchObject({ ok: false, error: { code: 'UPDATE_BUSY' } })
    expect(updater.installs).toHaveLength(0)
  })

  it('installs once nothing is running', () => {
    const updater = fakeUpdater()
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })
    updater.listeners.get('update-downloaded')?.()

    expect(service.install()).toMatchObject({ ok: true })
    expect(updater.installs).toHaveLength(1)
  })

  it('refuses to install what it has not downloaded', () => {
    const updater = fakeUpdater()
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })
    expect(service.install()).toMatchObject({ ok: false, error: { code: 'UPDATE_NOT_READY' } })
    expect(updater.installs).toHaveLength(0)
  })

  it('says up to date only after a check that finished', async () => {
    const service = createUpdateService({
      updater: fakeUpdater({
        checkForUpdates: async () => {
          throw new Error('offline')
        }
      }),
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })

    const response = await service.check()

    // A failed check that reported "current" is how a person ends up on an old
    // build believing they are on the newest one.
    expect(response).toMatchObject({ ok: true, data: { phase: 'failed' } })
  })

  it('names the version it found, and calls a matching one current', async () => {
    const newer = createUpdateService({
      updater: fakeUpdater({ checkForUpdates: async () => ({ updateInfo: { version: '0.6.0' } }) }),
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })
    await expect(newer.check()).resolves.toMatchObject({
      ok: true,
      data: { phase: 'available', availableVersion: '0.6.0' }
    })

    const same = createUpdateService({
      updater: fakeUpdater({ checkForUpdates: async () => ({ updateInfo: { version: '0.5.0' } }) }),
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0
    })
    await expect(same.check()).resolves.toMatchObject({ ok: true, data: { phase: 'current' } })
  })

  it('says a build that cannot update itself cannot, rather than that it is current', async () => {
    const updater = fakeUpdater({ checkForUpdates: vi.fn(async () => null) })
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0-dev',
      supported: false,
      liveMissionCount: () => 0
    })

    await expect(service.check()).resolves.toMatchObject({ ok: true, data: { phase: 'unsupported' } })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('never shows the provider its own error text', () => {
    const updater = fakeUpdater()
    const seen: string[] = []
    createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0,
      onStateChange: (state) => {
        if (state.message !== undefined) seen.push(state.message)
      }
    })

    updater.listeners.get('error')?.(new Error('ENOTFOUND https://example.invalid/token=secret'))

    expect(seen).toEqual(['The update check could not complete.'])
    expect(seen.join(' ')).not.toContain('secret')
  })
})
