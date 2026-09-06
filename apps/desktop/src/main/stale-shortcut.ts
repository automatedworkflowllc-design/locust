/**
 * The Start-menu shortcut that stole the taskbar icon (2026-09-06).
 *
 * Windows draws a running window's taskbar icon from the Start-menu entry
 * whose AppUserModelID matches the window's, when one exists. A development
 * run (electron.exe) had used the SAME id as the installed app and left a
 * shortcut named "Electron" carrying it, pointing at node_modules; from then
 * on every Locust window -- installed, packaged, dev -- wore Electron's atom,
 * no matter what icon the window itself carried (Colin: "it's literally
 * showing the electron emblem, and it worked prior"). The window's own icon
 * handles read back as the Locust mark the whole time; `Get-StartApps`
 * listed "Electron = com.automatedworkflow.locust".
 *
 * Two guards: development runs use an id of their own, and a packaged start
 * removes a shortcut that (1) carries the app's id and (2) points at an
 * electron.exe -- nothing else is ever touched.
 */

export const APP_USER_MODEL_ID = 'com.automatedworkflow.locust'
export const DEVELOPMENT_APP_USER_MODEL_ID = 'com.automatedworkflow.locust.dev'

export interface ShortcutFacts {
  readonly target: string
  readonly appUserModelId?: string
}

/** True only for a shortcut that carries this app's id and launches a bare electron.exe. */
export function isStaleElectronShortcut(link: ShortcutFacts, appId: string): boolean {
  if (link.appUserModelId !== appId) return false
  return /(^|[\\/])electron\.exe$/i.test(link.target.trim())
}

export interface StaleShortcutSweepOptions {
  /** The shortcut paths to consider, usually the Start menu's "Electron.lnk". */
  readonly candidates: readonly string[]
  readonly appId: string
  readonly readShortcut: (path: string) => ShortcutFacts | undefined
  readonly remove: (path: string) => void
}

/** Removes the stale shortcuts among the candidates; returns the paths removed. */
export function sweepStaleElectronShortcuts(options: StaleShortcutSweepOptions): readonly string[] {
  const removed: string[] = []
  for (const path of options.candidates) {
    let facts: ShortcutFacts | undefined
    try {
      facts = options.readShortcut(path)
    } catch {
      continue
    }
    if (facts === undefined || !isStaleElectronShortcut(facts, options.appId)) continue
    try {
      options.remove(path)
      removed.push(path)
    } catch {
      // A shortcut that cannot be removed is left; the icon is cosmetic.
    }
  }
  return removed
}
