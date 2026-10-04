/**
 * The record a beta tester can send back.
 *
 * Locust already wrote `locust-errors.log`: an uncaught exception or an
 * unhandled rejection in the MAIN process appends a line and the first one
 * raises a dialog naming the file. That much was right and is kept.
 *
 * What it could not see is the failure a person is most likely to have.
 * **A renderer crash raises no `uncaughtException` in main.** The window
 * simply goes blank, or vanishes, and the main process carries on perfectly
 * healthy with nothing to report — so the single most recognisable way for
 * this app to break ("Locust disappeared") wrote nothing at all. Same for a
 * utility or GPU child dying, and same for a window that stops answering.
 *
 * Three things are added here and nothing is taken away:
 *
 * 1. **The crashes main cannot throw** — `render-process-gone`,
 *    `child-process-gone`, `unresponsive` — become lines in the same file.
 * 2. **A cap.** The old log was append-only with no bound, which on a
 *    machine that fails in a loop is a file that grows until the disk says
 *    stop. One roll to `.1`, two files, oldest dropped.
 * 3. **A first line.** Every run records its version, platform and Electron
 *    build on startup. A log that reaches us without a version in it can
 *    only be answered with a question, and the person who sent it has
 *    usually updated by the time we ask.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * **Nothing is uploaded.** Settings tells a person, on screen, "Every mission
 * is recorded to an append-only ledger on this machine. Nothing is uploaded."
 * A crash reporter that phones home would make that sentence false, so
 * `crashReporter` runs with `uploadToServer: false` and the dumps stay in the
 * profile until a person chooses to send them.
 *
 * **No prompts, no file contents, no mission text.** This file is written to
 * be handed to someone else, and the thing that makes it safe to hand over is
 * that it records what HAPPENED, never what was said. Stack traces and
 * lifecycle events only. The ledger already holds the conversation and it is
 * deliberately not duplicated into a file whose whole purpose is to travel.
 */

/** One roll, two files. Enough to survive a crash loop, not enough to grow. */
export const MAX_LOG_BYTES = 512 * 1024

/**
 * Whether the log has earned a roll.
 *
 * `undefined` is "no file yet", which is the first-run case and not a roll.
 * A stat that throws is handled by the caller passing `undefined` — a
 * diagnostics file that cannot be measured must not stop the app writing to
 * it, because the whole point is to work when things are already wrong.
 */
export function shouldRoll(bytes: number | undefined, max: number = MAX_LOG_BYTES): boolean {
  return bytes !== undefined && bytes >= max
}

/** One line: when, what, and the detail, with the detail never blank. */
export function diagnosticLine(at: Date, label: string, detail: string): string {
  const said = detail.trim().length === 0 ? '(no detail)' : detail.trim()
  return `${at.toISOString()} ${label}: ${said}\n`
}

/**
 * What Electron says a renderer died of, in words.
 *
 * `reason` is Electron's own enum and the raw value is kept — a log is read
 * by whoever wrote the code, so the exact token matters more than the prose.
 * The prose is there because the first reader is usually not that person.
 */
export function describeGone(details: { readonly reason?: string; readonly exitCode?: number }): string {
  const reason = details.reason ?? 'unknown'
  const code = details.exitCode === undefined ? '' : ` exitCode=${String(details.exitCode)}`
  const said: Record<string, string> = {
    'clean-exit': 'exited normally',
    'abnormal-exit': 'exited abnormally',
    killed: 'was killed',
    crashed: 'crashed',
    oom: 'ran out of memory',
    'launch-failed': 'could not start',
    'integrity-failure': 'failed an integrity check'
  }
  const words = said[reason] ?? 'ended for an unrecognised reason'
  return `the window ${words} (reason=${reason}${code})`
}

/**
 * The detail every run opens with.
 *
 * Returns the DETAIL only -- `note` owns the timestamp and the label, and a
 * helper that built a whole line here would have produced two of each.
 *
 * Kept to facts that are true of the MACHINE and the BUILD, never of the
 * person: no username, no folder, no workspace. `app.getPath` values are
 * deliberately absent -- the one path worth knowing is the log's own, and
 * whoever is reading the log already found it.
 */
export function startupDetail(about: {
  readonly version: string
  readonly platform: string
  readonly release: string
  readonly electron: string
  readonly packaged: boolean
}): string {
  return `Locust ${about.version} · ${about.platform} ${about.release} · electron ${about.electron} · ${about.packaged ? 'packaged' : 'development'}`
}
