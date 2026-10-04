import { describe, expect, it } from 'vitest'

import { createUpdateService } from './updates.js'
import type { UpdaterLike } from './updates.js'

/**
 * "Downloaded" must name the version that is actually downloaded.
 *
 * Colin, 2026-09-21, stuck on 0.225 with three releases published above him
 * inside an hour: *"restart and install isnt working, keeps giving me the same
 * option on restart, like its showing it as downloaded but its not, still has
 * me at .225"*.
 *
 * The state machine kept `ready` across a check that found a DIFFERENT
 * version, and wrote the new version into `availableVersion`. So after
 * downloading one build and then checking against a newer one, the window
 * said the newer one was downloaded and offered Restart — and the installer
 * had nothing matching to run, so the restart came back on the same version
 * with the same button showing.
 *
 * It took three releases in one evening to surface, which is why it survived
 * two hundred of them.
 */

function fake(versions: readonly string[]): UpdaterLike & {
  readonly listeners: Map<string, (payload?: unknown) => void>
  readonly installs: number[]
} {
  const listeners = new Map<string, (payload?: unknown) => void>()
  const installs: number[] = []
  let at = 0
  return {
    listeners,
    installs,
    autoDownload: false,
    allowPrerelease: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: async () => {
      const version = versions[Math.min(at, versions.length - 1)] ?? versions[0] ?? '0.0.0'
      at += 1
      return { updateInfo: { version } }
    },
    downloadUpdate: async () => undefined,
    quitAndInstall: () => {
      installs.push(1)
    },
    on(event: string, listener: (payload?: unknown) => void) {
      listeners.set(event, listener)
      return this
    }
  }
}

const serviceOn = (updater: UpdaterLike & { readonly listeners: Map<string, (payload?: unknown) => void> }) =>
  createUpdateService({
    updater,
    currentVersion: '0.225.0',
    supported: true,
    liveMissionCount: () => 0,
    requestQuit: (finalise?: () => void) => finalise?.()
  })

describe('ready means THIS version is on disk', () => {
  it('stops calling a newer version downloaded when an older one was', async () => {
    const updater = fake(['0.226.0', '0.228.0'])
    const service = serviceOn(updater)

    await service.check()
    updater.listeners.get('update-downloaded')?.({ version: '0.226.0' })
    expect(service.state().phase).toBe('ready')
    expect(service.state().availableVersion).toBe('0.226.0')

    // Three releases land while that one sits in the pending folder.
    const after = await service.check()
    expect(after.ok).toBe(true)
    if (!after.ok) return
    // THE DEFECT: this used to stay `ready` and say 0.228.0 was downloaded.
    expect(after.data.phase).toBe('available')
    expect(after.data.availableVersion).toBe('0.228.0')
  })

  it('stays ready when the check finds the version that is on disk', async () => {
    const updater = fake(['0.226.0', '0.226.0'])
    const service = serviceOn(updater)
    await service.check()
    updater.listeners.get('update-downloaded')?.({ version: '0.226.0' })
    const after = await service.check()
    if (!after.ok) return
    expect(after.data.phase).toBe('ready')
  })

  it('refuses to install once the downloaded one is superseded', async () => {
    const updater = fake(['0.226.0', '0.228.0'])
    const service = serviceOn(updater)
    await service.check()
    updater.listeners.get('update-downloaded')?.({ version: '0.226.0' })
    await service.check()
    const result = service.install()
    expect(result.ok).toBe(false)
    // Better to say there is nothing to install than to restart into the
    // same version and offer the same button again.
    expect(updater.installs).toHaveLength(0)
  })

  it('falls back to the version it was looking for when the event carries none', async () => {
    const updater = fake(['0.226.0', '0.226.0'])
    const service = serviceOn(updater)
    await service.check()
    updater.listeners.get('update-downloaded')?.()
    expect(service.state().availableVersion).toBe('0.226.0')
    const after = await service.check()
    if (!after.ok) return
    expect(after.data.phase).toBe('ready')
  })
})
