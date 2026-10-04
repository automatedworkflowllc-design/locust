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

/**
 * Whether this launch may show OS notifications -- which, on Windows, is
 * whether it may point the Start-menu shortcut at itself.
 *
 * Electron writes a Start-menu shortcut for the app's id when it shows a
 * toast, targeting whatever copy is running: the "Electron.lnk" above is the
 * development build doing it. On 2026-09-23 a drive of a PACKAGED build, run
 * from a worktree's release folder, raised the new "waiting on you" notice for
 * an Antigravity question, and "Locust.lnk" in Colin's Start menu was
 * rewritten to that folder at that second. His installed copy then updated to
 * 0.280, and the installer relaunches through that shortcut -- so he was
 * running the drive's copy without knowing it, and it held the folder the
 * next release had to be packaged in.
 *
 * A scripted launch has no one to notify: every drive takes the window with
 * `--remote-debugging-port`, and nobody using Locust starts it that way. So it
 * shows none, and claims nothing.
 */
export function mayShowToasts(argv: readonly string[]): boolean {
  return !argv.some((argument) => argument.startsWith('--remote-debugging-port'))
}

export interface StartMenuRepairOptions {
  /** The Start menu's "Locust.lnk". */
  readonly path: string
  /** This process's executable. */
  readonly execPath: string
  /** Whether this copy is the INSTALLED one: the installer puts its uninstaller beside it. */
  readonly installed: boolean
  readonly readShortcut: (path: string) => ShortcutFacts | undefined
  readonly writeShortcut: (path: string, target: string) => void
}

const samePathText = (a: string, b: string): boolean =>
  a.trim().replace(/\//g, '\\').toLowerCase() === b.trim().replace(/\//g, '\\').toLowerCase()

/**
 * The installed copy takes the Start-menu shortcut back when anything else
 * holds it, and returns whether it did.
 *
 * The shortcut is what the taskbar pin resolves through and what the
 * updater's installer relaunches through, so whoever it points at is the
 * Locust that opens. Colin, 2026-09-24, after a worktree's build had opened
 * from his taskbar yet again: "ive never once opened a locust from anywhere
 * but my taskbar, and weve supposedly fixed it numerous times." Guards
 * against a drive rewriting it (see `mayShowToasts`) are one half; this is
 * the half that undoes it if anything ever does, the next time he opens the
 * real app. Only the installed copy may claim it -- a build folder never.
 */
export function repairStartMenuShortcut(options: StartMenuRepairOptions): boolean {
  if (!options.installed) return false
  let facts: ShortcutFacts | undefined
  try {
    facts = options.readShortcut(options.path)
  } catch {
    return false
  }
  if (facts === undefined || samePathText(facts.target, options.execPath)) return false
  try {
    options.writeShortcut(options.path, options.execPath)
    return true
  } catch {
    return false
  }
}
