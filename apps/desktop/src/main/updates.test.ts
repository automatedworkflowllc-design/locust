import { describe, expect, it, vi } from 'vitest'

import { createUpdateService } from './updates.js'
import type { UpdaterLike } from './updates.js'

function fakeUpdater(overrides: Partial<UpdaterLike> = {}): UpdaterLike & {
  readonly listeners: Map<string, (payload?: unknown) => void>
  readonly installs: { readonly isSilent?: boolean; readonly isForceRunAfter?: boolean }[]
  readonly quits: number[]
} {
  const listeners = new Map<string, (payload?: unknown) => void>()
  const installs: { readonly isSilent?: boolean; readonly isForceRunAfter?: boolean }[] = []
  const quits: number[] = []
  return {
    listeners,
    installs,
    quits,
    autoDownload: false,
    allowPrerelease: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => null,
    downloadUpdate: async () => undefined,
    quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => {
      installs.push({ isSilent, isForceRunAfter })
    },
    on(event: string, listener: (payload?: unknown) => void) {
      listeners.set(event, listener)
      return this
    },
    ...overrides
  }
}

describe('what the app does about a new version', () => {
  it('downloads on its own, and installs only on a quit the app itself makes', () => {
    const updater = fakeUpdater()
    createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0,
      requestQuit: () => {
        updater.quits.push(1)
      }
    })
    // Downloading is quiet and safe. Installing swaps the binary and restarts,
    // which must never happen while nobody is watching -- including at quit,
    // which is just someone closing a window.
    expect(updater.autoDownload).toBe(true)
    // On, deliberately: the install rides the app's own quit, which the
    // shutdown handler owns. install() still never runs while a mission is
    // live, because it refuses before asking for that quit.
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  // A B4 lead from the code review, settled: a check that failed AFTER a
  // download hid Install and restart, with the installer still on disk.
  it('keeps a downloaded update installable when a later check fails', async () => {
    let fail = false
    const updater = fakeUpdater({ checkForUpdates: vi.fn(async () => { if (fail) throw new Error('offline'); return { updateInfo: { version: '0.6.0' }, isUpdateAvailable: true } as never }) })
    const service = createUpdateService({ updater, currentVersion: '0.5.0', supported: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    await service.check()
    updater.listeners.get('update-downloaded')?.({ version: '0.6.0' })
    expect(service.state().phase).toBe('ready')
    fail = true
    await service.check()
    expect(service.state()).toMatchObject({ phase: 'ready', availableVersion: '0.6.0' })
    updater.listeners.get('error')?.()
    expect(service.state().phase).toBe('ready')
    expect(service.install().ok).toBe(true)
  })

  it('does not install on a quit that is a relaunch (M19)', () => {
    const updater = fakeUpdater()
    const service = createUpdateService({ updater, currentVersion: '0.5.0', supported: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    updater.listeners.get('update-downloaded')?.({ version: '0.6.0' })
    service.holdInstallForRelaunch()
    // electron-updater reads this when the app quits; off, the silent install
    // that would stop the relaunched app never starts.
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.installs).toEqual([])
    expect(service.state().phase).toBe('ready')
  })

  it('refuses to install while a mission is running, and says why', () => {
    const updater = fakeUpdater({
      checkForUpdates: async () => ({ updateInfo: { version: '0.6.0' } })
    })
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 1,
      requestQuit: () => {
        updater.quits.push(1)
      }
    })
    updater.listeners.get('update-downloaded')?.()

    const response = service.install()

    expect(response).toMatchObject({ ok: false, error: { code: 'UPDATE_BUSY' } })
    expect(updater.installs).toHaveLength(0)
    expect(updater.quits).toHaveLength(0)
  })

  it('installs by asking the app to quit, so the shutdown flush runs first and the updater installs on the real quit', () => {
    let finaliser: (() => void) | undefined
    const updater = fakeUpdater()
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0,
      requestQuit: (onFlushed) => {
        updater.quits.push(1)
        finaliser = onFlushed
      }
    })
    updater.listeners.get('update-downloaded')?.()

    expect(service.install()).toMatchObject({ ok: true })
    // It asks for a quit and hands over what to do at the END of it. Calling
    // quitAndInstall() straight away was cancelled by the app's own shutdown
    // handler, which prevents the first quit to flush the ledger -- so
    // nothing has installed yet at this point.
    expect(updater.installs).toHaveLength(0)
    expect(updater.quits).toHaveLength(1)
    expect(finaliser).toBeDefined()

    // Once the ledger is flushed, the shutdown runs it -- and THIS is the
    // call that starts the app again afterwards. Installing on quit alone
    // was silent and started nothing (Colin, 2026-09-06: "the restart after
    // update and restart has never worked").
    finaliser?.()
    expect(updater.installs).toEqual([{ isSilent: true, isForceRunAfter: true }])
  })

  it('refuses to install what it has not downloaded', () => {
    const updater = fakeUpdater()
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0,
      requestQuit: () => {
        updater.quits.push(1)
      }
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
      liveMissionCount: () => 0,
      requestQuit: () => {
        undefined
      }
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
      liveMissionCount: () => 0,
      requestQuit: () => {
        undefined
      }
    })
    await expect(newer.check()).resolves.toMatchObject({
      ok: true,
      data: { phase: 'available', availableVersion: '0.6.0' }
    })

    const same = createUpdateService({
      updater: fakeUpdater({ checkForUpdates: async () => ({ updateInfo: { version: '0.5.0' } }) }),
      currentVersion: '0.5.0',
      supported: true,
      liveMissionCount: () => 0,
      requestQuit: () => {
        undefined
      }
    })
    await expect(same.check()).resolves.toMatchObject({ ok: true, data: { phase: 'current' } })
  })

  it('says a build that cannot update itself cannot, rather than that it is current', async () => {
    const updater = fakeUpdater({ checkForUpdates: vi.fn(async () => null) })
    const service = createUpdateService({
      updater,
      currentVersion: '0.5.0-dev',
      supported: false,
      liveMissionCount: () => 0,
      requestQuit: () => {
        updater.quits.push(1)
      }
    })

    await expect(service.check()).resolves.toMatchObject({ ok: true, data: { phase: 'unsupported' } })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('never installs anything at quit from a copy that is not the installed one (0.507)', () => {
    // A test copy that quit with an update pending in the shared cache ran the
    // installer, which closed the person's own Locust (2026-09-30, twice).
    const updater = fakeUpdater()
    createUpdateService({ updater, currentVersion: '0.504.0', supported: false, liveMissionCount: () => 0, requestQuit: () => undefined })
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.autoDownload).toBe(false)
  })

  it('a copy that only asks reads the feed and still never downloads or installs (0.507)', async () => {
    const updater = fakeUpdater({ checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '0.6.0' }, isUpdateAvailable: true })) })
    const service = createUpdateService({ updater, currentVersion: '0.5.0', supported: true, checkOnly: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    await expect(service.check()).resolves.toMatchObject({ ok: true, data: { phase: 'available', availableVersion: '0.6.0' } })
    expect(updater.checkForUpdates).toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.listeners.has('update-downloaded')).toBe(false)
  })

  it('never shows the provider its own error text', () => {
    const updater = fakeUpdater()
    const seen: string[] = []
    createUpdateService({
      updater,
      currentVersion: '0.5.0',
      supported: true,
      requestQuit: () => undefined,
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

/*
 * A download that fails is a line in Settings, never the crash dialog
 * (2026-09-24: a release published before its installer was up gave Colin
 * "Locust hit a problem" for a 404). Vitest fails a test on an unhandled
 * rejection, so this test failing is the dialog.
 */
describe('a download that fails', () => {
  it('is said as a download that failed, and nothing is left unhandled', async () => {
    const failed = Promise.reject(new Error('Cannot download ... status 404'))
    const updater = fakeUpdater({
      checkForUpdates: async () => ({ updateInfo: { version: '0.6.0' }, isUpdateAvailable: true, downloadPromise: failed })
    })
    const service = createUpdateService({ updater, currentVersion: '0.5.0', supported: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    await service.check()
    // The updater's own report of the failure, as electron-updater sends it.
    updater.listeners.get('error')?.(new Error('Cannot download ... status 404'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(service.state()).toMatchObject({ phase: 'failed', message: 'The update could not be downloaded. Locust will try again at its next check.' })
  })

  it('keeps the check\'s own sentence for a check that failed', async () => {
    const updater = fakeUpdater()
    const service = createUpdateService({ updater, currentVersion: '0.5.0', supported: true, liveMissionCount: () => 0, requestQuit: () => undefined })
    updater.listeners.get('error')?.(new Error('offline'))
    expect(service.state()).toMatchObject({ phase: 'failed', message: 'The update check could not complete.' })
  })
})

