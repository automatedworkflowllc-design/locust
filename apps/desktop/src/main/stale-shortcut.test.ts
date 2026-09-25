import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { APP_USER_MODEL_ID, isStaleElectronShortcut, repairStartMenuShortcut, sweepStaleElectronShortcuts } from './stale-shortcut.js'

const APP = 'com.automatedworkflow.locust'

describe('the stale Electron shortcut', () => {
  it('is one carrying the app id and pointing at a bare electron.exe', () => {
    expect(
      isStaleElectronShortcut(
        { target: 'C:\\repo\\apps\\desktop\\node_modules\\electron\\dist\\electron.exe', appUserModelId: APP },
        APP
      )
    ).toBe(true)
  })

  it('is not the installed app, another id, or a shortcut with no id', () => {
    expect(isStaleElectronShortcut({ target: 'C:\\Users\\x\\AppData\\Local\\Programs\\Locust\\Locust.exe', appUserModelId: APP }, APP)).toBe(false)
    expect(isStaleElectronShortcut({ target: 'C:\\x\\electron.exe', appUserModelId: 'com.electron.notion' }, APP)).toBe(false)
    expect(isStaleElectronShortcut({ target: 'C:\\x\\electron.exe' }, APP)).toBe(false)
    expect(isStaleElectronShortcut({ target: 'C:\\x\\notelectron.exe', appUserModelId: APP }, APP)).toBe(false)
  })

  it('is removed by the sweep, and nothing else is', () => {
    const removed: string[] = []
    const links: Record<string, { target: string; appUserModelId?: string }> = {
      'C:\\start\\Electron.lnk': { target: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe', appUserModelId: APP },
      'C:\\start\\Locust.lnk': { target: 'C:\\Programs\\Locust\\Locust.exe', appUserModelId: APP }
    }
    const result = sweepStaleElectronShortcuts({
      candidates: ['C:\\start\\Electron.lnk', 'C:\\start\\Locust.lnk', 'C:\\start\\Missing.lnk'],
      appId: APP,
      readShortcut: (path) => {
        const link = links[path]
        if (link === undefined) throw new Error('no such shortcut')
        return link
      },
      remove: (path) => {
        removed.push(path)
      }
    })
    expect(result).toEqual(['C:\\start\\Electron.lnk'])
    expect(removed).toEqual(['C:\\start\\Electron.lnk'])
  })

  it('leaves a shortcut it cannot remove', () => {
    const result = sweepStaleElectronShortcuts({
      candidates: ['C:\\start\\Electron.lnk'],
      appId: APP,
      readShortcut: () => ({ target: 'C:\\x\\electron.exe', appUserModelId: APP }),
      remove: () => {
        throw new Error('locked')
      }
    })
    expect(result).toEqual([])
  })
})

/*
 * 2026-09-24: a drive re-pointed the Start-menu Locust.lnk at a worktree's
 * release folder, and Colin's taskbar opened that copy. Measured the same
 * night: `Notification.isSupported()` alone rewrites the shortcut to the
 * calling copy, and the guard asked it BEFORE asking whether this was a drive.
 */
describe('the Start-menu shortcut', () => {
  const INSTALLED = 'C:\\Users\\x\\AppData\\Local\\Programs\\Locust\\Locust.exe'
  const BUILD = 'C:\\w\\apps\\desktop\\release\\win-unpacked\\Locust.exe'
  const repair = (installed: boolean, target: string | undefined) => {
    const writes: string[] = []
    const did = repairStartMenuShortcut({
      path: 'Locust.lnk',
      execPath: INSTALLED,
      installed,
      readShortcut: () => (target === undefined ? undefined : { target, appUserModelId: APP_USER_MODEL_ID }),
      writeShortcut: (_path, to) => writes.push(to)
    })
    return { did, writes }
  }

  it('is taken back by the installed copy from a build folder', () => {
    expect(repair(true, BUILD)).toEqual({ did: true, writes: [INSTALLED] })
  })

  it('is left alone when it already points here, whatever the case or slashes', () => {
    expect(repair(true, INSTALLED.toLowerCase().replace(/\\/g, '/'))).toEqual({ did: false, writes: [] })
  })

  it('is never claimed by a copy that is not installed, and never made where there is none', () => {
    expect(repair(false, BUILD)).toEqual({ did: false, writes: [] })
    expect(repair(true, undefined)).toEqual({ did: false, writes: [] })
  })

  it('is not touched by a drive: the drive check comes before Notification.isSupported()', () => {
    const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    expect(index).toContain('supported: () => mayShowToasts(process.argv) && Notification.isSupported()')
    expect(index).not.toContain('Notification.isSupported() && mayShowToasts')
  })
})
