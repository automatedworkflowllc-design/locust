import { describe, expect, it } from 'vitest'

import { isStaleElectronShortcut, sweepStaleElectronShortcuts } from './stale-shortcut.js'

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
