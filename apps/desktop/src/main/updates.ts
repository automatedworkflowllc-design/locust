import type { AppUpdateResponse, AppUpdateState } from '../shared/ipc.js'

/**
 * Updates.
 *
 * The rules this follows, and why:
 *
 * - It CHECKS automatically and INSTALLS only when asked. A desktop agent can
 *   be holding a running mission and a durable ledger writer; swapping the
 *   binary underneath that is not something to do while someone is away from
 *   the keyboard. So: tell them a version exists, download it, and let them
 *   choose the moment.
 * - It never installs while a mission is running. The host knows what is
 *   live, so the question is answered here rather than guessed.
 * - It says what it knows and no more. "Up to date" is only said after a
 *   check actually completed; a check that could not run says so, because a
 *   silent failure that looks like "you are current" is how people end up on
 *   an old build believing otherwise.
 *
 * The feed is public even though the source repository is private: publishing
 * to a private repo would mean shipping a token inside every installed copy,
 * and a token that reads a private repo is not something to hand out.
 */

/** What an updater must provide. Electron's is injected so this is testable. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{ readonly updateInfo: { readonly version: string } } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (payload?: unknown) => void): unknown
}

export interface UpdateServiceOptions {
  readonly updater: UpdaterLike
  readonly currentVersion: string
  /** Whether this build can update itself at all. */
  readonly supported: boolean
  /** Missions running right now; an install waits for them. */
  readonly liveMissionCount: () => number
  readonly onStateChange?: (state: AppUpdateState) => void
}

export interface UpdateService {
  state(): AppUpdateState
  check(): Promise<AppUpdateResponse>
  install(): AppUpdateResponse
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  let state: AppUpdateState = {
    phase: options.supported ? 'idle' : 'unsupported',
    currentVersion: options.currentVersion
  }

  const publish = (next: AppUpdateState): AppUpdateState => {
    state = next
    options.onStateChange?.(next)
    return next
  }

  if (options.supported) {
    // Downloading is safe and quiet; installing is not, so it never happens
    // on its own -- not even at quit, which would swap the binary under a
    // person who only closed the window.
    options.updater.autoDownload = true
    options.updater.autoInstallOnAppQuit = false
    options.updater.on('download-progress', (payload) => {
      const percent = (payload as { readonly percent?: number } | undefined)?.percent
      if (state.phase !== 'downloading' && state.phase !== 'available') return
      publish({
        phase: 'downloading',
        currentVersion: options.currentVersion,
        ...(state.availableVersion === undefined ? {} : { availableVersion: state.availableVersion }),
        ...(typeof percent === 'number' ? { percent: Math.max(0, Math.min(100, Math.round(percent))) } : {})
      })
    })
    options.updater.on('update-downloaded', () => {
      publish({
        phase: 'ready',
        currentVersion: options.currentVersion,
        ...(state.availableVersion === undefined ? {} : { availableVersion: state.availableVersion })
      })
    })
    options.updater.on('error', () => {
      // Deliberately not the provider's message: it can carry URLs and paths,
      // and this string is shown in the window.
      publish({
        phase: 'failed',
        currentVersion: options.currentVersion,
        message: 'The update check could not complete.'
      })
    })
  }

  return {
    state: () => state,

    async check(): Promise<AppUpdateResponse> {
      if (!options.supported) {
        return {
          ok: true,
          data: { phase: 'unsupported', currentVersion: options.currentVersion }
        }
      }
      publish({ phase: 'checking', currentVersion: options.currentVersion })
      try {
        const result = await options.updater.checkForUpdates()
        const version = result?.updateInfo.version
        if (version === undefined || version === options.currentVersion) {
          // Only said after a check that actually finished.
          return { ok: true, data: publish({ phase: 'current', currentVersion: options.currentVersion }) }
        }
        return {
          ok: true,
          data: publish({
            phase: state.phase === 'ready' ? 'ready' : 'available',
            currentVersion: options.currentVersion,
            availableVersion: version
          })
        }
      } catch {
        return {
          ok: true,
          data: publish({
            phase: 'failed',
            currentVersion: options.currentVersion,
            message: 'The update check could not complete.'
          })
        }
      }
    },

    install(): AppUpdateResponse {
      if (state.phase !== 'ready') {
        return {
          ok: false,
          error: { code: 'UPDATE_NOT_READY', message: 'There is no downloaded update to install yet.' }
        }
      }
      // A running mission holds a provider process and a ledger writer.
      // Restarting under it would cut the run and leave the record without a
      // terminal receipt, which is exactly the state the ledger calls
      // interrupted.
      if (options.liveMissionCount() > 0) {
        return {
          ok: false,
          error: {
            code: 'UPDATE_BUSY',
            message: 'A mission is still running. Stop it first, then install — restarting now would cut it off mid-run.'
          }
        }
      }
      options.updater.quitAndInstall(false, true)
      return { ok: true, data: state }
    }
  }
}
