import { describe, expect, it } from 'vitest'

import { TESTER_LANE, updateLaneFrom } from './update-lane.js'
import { createUpdateService } from './updates.js'
import type { UpdaterLike } from './updates.js'

/**
 * TESTERS GET ONE BUILD A DAY; WHOEVER ASKS GETS EVERY BUILD.
 *
 * The beta handover, 2026-09-23: "Every release puts the update banner in
 * front of a tester, and the build they're reporting on is gone within the
 * hour. Testers should get at most one new build a day." Every build is a
 * GitHub prerelease; one a day is promoted to latest; electron-updater takes
 * prereleases only with `allowPrerelease` -- which is Settings' "every
 * build" switch, off unless turned on.
 */
function updater(): UpdaterLike {
  return {
    autoDownload: false,
    allowPrerelease: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: async () => null,
    downloadUpdate: async () => undefined,
    quitAndInstall: () => undefined,
    on: () => undefined
  }
}

const service = (fake: UpdaterLike, everyBuild?: boolean) =>
  createUpdateService({
    updater: fake,
    currentVersion: '0.307.0',
    supported: true,
    liveMissionCount: () => 0,
    requestQuit: () => undefined,
    ...(everyBuild === undefined ? {} : { everyBuild })
  })

describe('the lane', () => {
  it('is the tester lane unless every build was chosen, whatever the file says', () => {
    expect(updateLaneFrom(undefined)).toEqual(TESTER_LANE)
    expect(updateLaneFrom({ everyBuild: 'yes' })).toEqual(TESTER_LANE)
    expect(updateLaneFrom({ everyBuild: true })).toEqual({ everyBuild: true })
    expect(TESTER_LANE.everyBuild).toBe(false)
  })

  it('takes no prerelease by default -- even from an updater that would', () => {
    const fake = updater()
    const updates = service(fake)
    expect(fake.allowPrerelease).toBe(false)
    expect(updates.state().everyBuild).toBe(false)
  })

  it('takes every build once chosen, and says so in every state after', async () => {
    const fake = updater()
    const updates = service(fake)
    expect(updates.setEveryBuild(true).everyBuild).toBe(true)
    expect(fake.allowPrerelease).toBe(true)
    const checked = await updates.check()
    expect(checked.ok && checked.data.everyBuild).toBe(true)
    updates.setEveryBuild(false)
    expect(fake.allowPrerelease).toBe(false)
  })

  it('starts on the saved lane', () => {
    const fake = updater()
    service(fake, true)
    expect(fake.allowPrerelease).toBe(true)
  })
})
