/**
 * CLOSING THE WINDOW WHILE A TEAMMATE WORKS ASKS FIRST (0.382).
 *
 * Closing Locust mid-job stops every run: the host cancels each on the way
 * out and writes a `shutdown` checkpoint, and the conversation offers Resume
 * afterwards (renderer resume.ts). That recovers work nobody meant to stop --
 * better that it is not stopped by accident. Orca keeps its agents alive
 * across a quit in a background host (read 2026-09-26); until Locust has one,
 * the window says what closing would do, and the person decides.
 *
 * Asked ONLY when the person closes the window. Never while the app is
 * already quitting -- the folder-switch relaunch and the updater call
 * `app.quit()`, which comes first, and refusing it would leave a relaunch
 * queued for some later exit -- and never while Windows is ending the
 * session: a shutdown is not to be held up by a question.
 */

export interface CloseMoment {
  /** Runs live in either transport now. */
  readonly liveRuns: number
  /** `app.quit()` has begun (a relaunch, the updater, a quit from the menu). */
  readonly appQuitting: boolean
  /** Windows is shutting down, restarting or logging off. */
  readonly sessionEnding: boolean
  /** The person already answered "Quit anyway" for this close. */
  readonly confirmed: boolean
}

export function shouldAskBeforeClosing(moment: CloseMoment): boolean {
  return moment.liveRuns > 0 && !moment.appQuitting && !moment.sessionEnding && !moment.confirmed
}

/** Who is working, as a sentence's subject: "Wren is", "Wren and Sable are", "2 teammates are". */
function whoIsWorking(workingNames: readonly string[], liveRuns: number): string {
  const names = [...new Set(workingNames)]
  return names.length === 0
    ? liveRuns === 1 ? 'A teammate is' : `${String(liveRuns)} teammates are`
    : names.length === 1
      ? `${names[0]!} is`
      : names.length === 2
        ? `${names[0]!} and ${names[1]!} are`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!} are`
}

/**
 * The question, naming who is working when the names are known.
 *
 * 0.397: the answer that keeps the work going no longer means "don't close"
 * -- it closes the WINDOW and keeps Locust running in the tray until the
 * work is done (Orca's #3, the part that fits: runs that outlive the window).
 * Before, a person who wanted the window gone had to choose between it and
 * the run.
 */
export function closeQuestion(workingNames: readonly string[], liveRuns: number): { readonly message: string; readonly detail: string } {
  const names = [...new Set(workingNames)]
  const them = names.length === 1 || (names.length === 0 && liveRuns === 1) ? 'the run stops' : 'their runs stop'
  return {
    message: `${whoIsWorking(workingNames, liveRuns)} still working.`,
    detail: `Keep them working and Locust closes to the tray until you open it again, with a notification when they finish. If you quit now, ${them}; you can resume from the conversation when you're back.`
  }
}

/** The buttons, in order: keeping the work going is the default; Cancel leaves the window open. */
export const CLOSE_BUTTONS = ['Keep working in the background', 'Quit anyway', 'Cancel'] as const

/** The tray's line while Locust runs without a window: who is working, or that nobody is. */
export function trayLine(workingNames: readonly string[], liveRuns: number): string {
  if (liveRuns === 0) return 'Locust: nobody is working. Click to open.'
  return `Locust: ${whoIsWorking(workingNames, liveRuns).replace(/ (is|are)$/, ' $1 working')}.`
}
