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
  /** Take prereleases too: the "every build" lane (update-lane.ts). */
  allowPrerelease: boolean
  /**
   * Whether the updater runs the installer when the app quits by any route.
   * Kept ON: the app's own shutdown handler cancels the first quit to flush
   * the ledger and then quits again itself, and a quitAndInstall() that
   * relied on its own quit was cancelled with it. Measured 2026-09-03: five
   * releases sat downloaded in the pending folder while the installed copy
   * stayed at 0.9.1. With this on, the flush finishes, the real quit runs,
   * and the installer runs after it.
   */
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<{
    readonly updateInfo: { readonly version: string }
    /** electron-updater's own answer: false for the same version, or an older one. */
    readonly isUpdateAvailable?: boolean
    /**
     * The download `autoDownload` started. It REJECTS when the download
     * fails, after the updater has already said so with its 'error' event.
     */
    readonly downloadPromise?: Promise<unknown> | null
  } | null>
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
  /** Begin the app's own shutdown; the updater installs on the quit that follows. */
  /**
   * Ask the app to quit. The optional finaliser runs INSTEAD of the last
   * `app.quit()`, once the ledger has been flushed -- which is the only
   * moment `quitAndInstall` can be called without the shutdown handler
   * cancelling it, and the only way the installer is asked to start the app
   * again afterwards.
   */
  readonly requestQuit: (finalise?: () => void) => void
  readonly onStateChange?: (state: AppUpdateState) => void
  /** Every build, or only the one a day testers get (update-lane.ts). */
  readonly everyBuild?: boolean
}

export interface UpdateService {
  state(): AppUpdateState
  check(): Promise<AppUpdateResponse>
  install(): AppUpdateResponse
  /** Change lanes; the next check takes the new one. */
  setEveryBuild(everyBuild: boolean): AppUpdateState
  /**
   * M19 (the code review): the next quit is a RELAUNCH, so it must not
   * install. A downloaded update installs on quit, silently -- and a silent
   * install starts nothing and stops every Locust running from the install
   * folder, including the one the relaunch has just started. Switching
   * folders then closed the app for good. The update stays downloaded; the
   * relaunched app installs it on its own next quit, or on Install.
   */
  holdInstallForRelaunch(): void
  /**
   * Look again every so often while the app stays open (C2, 0.367). Returns
   * the way to stop.
   */
  startPeriodicChecks(everyMs?: number, retryMs?: number): () => void
}

/**
 * How often a Locust left open looks for a new version of itself.
 *
 * It looked ONCE, eight seconds after launch (known issue 5) -- so a person
 * who keeps the app open for days, which is how a teammate app is used, never
 * heard of a single release until they happened to restart it. Six hours is
 * the same rhythm the coding agents' own updates keep (runtime-updates.ts).
 */
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000
/** A look skipped because a teammate was working is tried again this soon, not six hours later. */
export const UPDATE_RETRY_AFTER_RUN_MS = 15 * 60 * 1000

/**
 * Whether a periodic look should happen now: never while a teammate is
 * working -- a download beside a run is the one thing a slow line notices --
 * and never while a check is under way or a version is already found, on its
 * way down, or waiting to be installed. After a check that could not
 * complete, yes: that is what the next look is for.
 */
export function periodicCheckDue(state: AppUpdateState, liveMissions: number): boolean {
  if (liveMissions > 0) return false
  return state.phase === 'idle' || state.phase === 'current' || state.phase === 'failed'
}

/** `a` is a later version than `b`, by major.minor.patch; unreadable is never later. */
export function isNewer(a: string, b: string): boolean {
  const parse = (text: string): readonly number[] | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const x = parse(a)
  const y = parse(b)
  if (x === undefined || y === undefined) return a !== b
  for (let index = 0; index < 3; index += 1) {
    if (x[index]! !== y[index]!) return x[index]! > y[index]!
  }
  return false
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  let everyBuild = options.everyBuild === true
  options.updater.allowPrerelease = everyBuild
  let state: AppUpdateState = {
    phase: options.supported ? 'idle' : 'unsupported',
    currentVersion: options.currentVersion,
    everyBuild
  }

  // Every state carries the lane, so no phase change can drop it.
  const publish = (next: AppUpdateState): AppUpdateState => {
    state = { ...next, everyBuild }
    options.onStateChange?.(state)
    return state
  }

  if (options.supported) {
    // Downloading is safe and quiet; installing is not, so it never happens
    // on its own -- not even at quit, which would swap the binary under a
    // person who only closed the window.
    options.updater.autoDownload = true
    options.updater.autoInstallOnAppQuit = true
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
    options.updater.on('update-downloaded', (payload) => {
      /*
       * WHICH version is on disk, remembered -- see `check` for why.
       *
       * The event carries the `UpdateInfo` it downloaded. `state.availableVersion`
       * is the fallback for an updater that sends nothing, which is what the
       * tests' fake did before this.
       */
      const version = (payload as { readonly version?: unknown } | undefined)?.version
      downloadedVersion = typeof version === 'string' ? version : state.availableVersion
      publish({
        phase: 'ready',
        currentVersion: options.currentVersion,
        ...(downloadedVersion === undefined ? {} : { availableVersion: downloadedVersion })
      })
    })
    options.updater.on('error', () => {
      // An update already on disk stays installable: a check that failed
      // after the download hid Install and restart with the installer still
      // there (a B4 lead).
      if (downloadedVersion !== undefined) {
        publish({ phase: 'ready', currentVersion: options.currentVersion, availableVersion: downloadedVersion })
        return
      }
      // Deliberately not the provider's message: it can carry URLs and paths,
      // and this string is shown in the window. Which step failed IS said:
      // a download that failed after the check found a version is not a
      // check that could not complete.
      const downloading = state.phase === 'available' || state.phase === 'downloading'
      publish({
        phase: 'failed',
        currentVersion: options.currentVersion,
        message: downloading
          ? 'The update could not be downloaded. Locust will try again at its next check.'
          : 'The update check could not complete.'
      })
    })
  }

  /** The version actually sitting in the pending folder, if any. */
  let downloadedVersion: string | undefined

  const service: UpdateService = {
    state: () => state,

    startPeriodicChecks(everyMs = UPDATE_CHECK_EVERY_MS, retryMs = UPDATE_RETRY_AFTER_RUN_MS) {
      let timer: ReturnType<typeof setTimeout> | undefined
      let stopped = false
      const schedule = (after: number): void => {
        timer = setTimeout(tick, after)
        // Never the reason the process stays alive.
        ;(timer as { unref?: () => void }).unref?.()
      }
      const tick = (): void => {
        if (stopped || !options.supported) return
        const live = options.liveMissionCount()
        if (live > 0) {
          schedule(retryMs)
          return
        }
        if (periodicCheckDue(state, live)) void service.check()
        schedule(everyMs)
      }
      schedule(everyMs)
      return () => {
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
      }
    },

    setEveryBuild(next) {
      everyBuild = next
      options.updater.allowPrerelease = next
      return publish(state)
    },

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
        /*
         * THE DOWNLOAD'S FAILURE IS ANSWERED HERE, NOT BY THE CRASH DIALOG.
         *
         * With `autoDownload` on, the check starts the download and hands
         * back its promise; when the download fails the updater emits
         * 'error' (handled above) and the promise rejects too. Nothing held
         * that promise, so the rejection went to `unhandledRejection` -- and
         * a published release whose installer was not up yet put "Locust hit
         * a problem ... Something went wrong inside Locust" in front of Colin
         * (2026-09-24, a 404 for 0.325.0; the same on 2026-09-23 for 0.269.0).
         * A download that did not work is a line in Settings, not a crash.
         */
        void result?.downloadPromise?.catch(() => undefined)
        const version = result?.updateInfo.version
        /*
         * ONLY A NEWER VERSION IS AN UPDATE (0.308). The tester lane takes
         * `latest` -- the one build a day -- and a build AHEAD of it (a
         * prerelease taken on "every build", with the switch turned off
         * again; any build before its day's promotion) found latest, 0.307,
         * from 0.308, and called that an update: 'available', a Download
         * that electron-updater, refusing to go backwards, never starts. The
         * update smoke hung on it (2026-09-23). Older or the same is up to
         * date.
         */
        if (version === undefined || result?.isUpdateAvailable === false || !isNewer(version, options.currentVersion)) {
          // Only said after a check that actually finished.
          return { ok: true, data: publish({ phase: 'current', currentVersion: options.currentVersion }) }
        }
        /*
         * READY MEANS *THIS* VERSION IS ON DISK, and it used to mean only
         * that SOMETHING was.
         *
         * Colin, 2026-09-21, stuck on 0.225 with three releases published
         * above him in quick succession: *"restart and install isnt working,
         * keeps giving me the same option on restart, like its showing it as
         * downloaded but its not"*.
         *
         * Exactly what the old line did. It kept `phase: 'ready'` and wrote
         * the NEWLY FOUND version into `availableVersion`, so after
         * downloading one version and then checking again against a newer
         * one, the window said the newer version was downloaded and offered
         * Restart. The installer then had nothing matching to run -- the
         * pending file was the older build -- so the restart came back on the
         * same version, and the same button was there again.
         *
         * It needed three releases in an evening to show up, which is why it
         * survived 200 of them. A downloaded update is now `ready` only while
         * the version on disk is the version the check just found; anything
         * else is `available`, which is the state that offers Download.
         */
        /*
         * `downloadedVersion` ALONE, not `state.phase === 'ready'` beside it.
         *
         * The first version of this fix read the phase and always saw
         * `checking`, because this function publishes that before it asks --
         * so it reported `available` even for the version genuinely sitting
         * on disk. Caught by the test written for the defect above, which is
         * the argument for writing it first.
         *
         * The field is set only by `update-downloaded`, so it is the whole
         * truth on its own.
         */
        const onDisk = downloadedVersion !== undefined && downloadedVersion === version
        if (!onDisk) downloadedVersion = undefined
        return {
          ok: true,
          data: publish({
            phase: onDisk ? 'ready' : 'available',
            currentVersion: options.currentVersion,
            availableVersion: version
          })
        }
      } catch {
        // The same rule: what is downloaded can still be installed.
        if (downloadedVersion !== undefined) {
          return { ok: true, data: publish({ phase: 'ready', currentVersion: options.currentVersion, availableVersion: downloadedVersion }) }
        }
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

    holdInstallForRelaunch(): void {
      // Read by electron-updater at the quit itself, not when the handler
      // was added, so turning it off here is enough (BaseUpdater.addQuitHandler).
      options.updater.autoInstallOnAppQuit = false
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
      // Ask the app to quit, and hand it what to do once the ledger is
      // flushed. `autoInstallOnAppQuit` alone DID install -- and never came
      // back, because installing on quit is silent and starts nothing
      // (Colin, 2026-09-06: "the restart after update and restart has never
      // worked"). `quitAndInstall(isSilent, isForceRunAfter)` is the call
      // that relaunches, and it could not be made earlier: from outside the
      // shutdown it was cancelled by the very handler that flushes. Run as
      // the finaliser, it is the last thing the app does.
      //
      // `autoInstallOnAppQuit` stays on as the backstop: if the finaliser
      // never runs -- a crash mid-flush, a quit from somewhere else -- the
      // update still installs, exactly as it did before. What changes is
      // that the ordinary path now starts the app again afterwards.
      options.requestQuit(() => {
        options.updater.quitAndInstall(true, true)
      })
      return { ok: true, data: state }
    }
  }
  return service
}
