import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { describeGone, diagnosticLine, MAX_LOG_BYTES, shouldRoll, startupDetail } from './diagnostics.js'

/**
 * A beta produces no information unless the app can say what happened.
 *
 * The beta plan of 2026-09-14 ranked this first, and the first draft of it
 * overstated the case — it said there was no diagnostic log at all. There
 * was: `locust-errors.log` has always caught an uncaught exception or an
 * unhandled rejection in the MAIN process and raised a dialog naming the
 * file. **State scope, not absence**, the same ruling this repo already runs
 * under, and the scope was narrower than the claim.
 *
 * What was really missing is sharper than what was claimed:
 *
 * | | before | after |
 * | --- | --- | --- |
 * | main throws | logged, dialog | unchanged |
 * | **the renderer dies** | **nothing at all** | logged |
 * | a child process dies | nothing | logged |
 * | a window stops answering | nothing | logged |
 * | which version it was | nothing | first line of every run |
 * | file size | unbounded | capped, one roll |
 * | how a person finds it | only if a dialog fired | Settings · Report a problem |
 *
 * The renderer row is the one that matters. **A renderer crash raises no
 * `uncaughtException` in main** — the window goes blank or disappears and
 * main carries on healthy with nothing to report. That is precisely the
 * failure a tester would describe as "Locust disappeared", and it was the
 * one failure that wrote nothing.
 */

const MAIN = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
const SCREENS = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)),
  'utf8'
)

describe('the log rolls rather than growing for ever', () => {
  it('does not roll a file that does not exist yet', () => {
    // First run. `undefined` is "nothing to measure", not "zero bytes".
    expect(shouldRoll(undefined)).toBe(false)
  })

  it('does not roll a small one', () => {
    expect(shouldRoll(10)).toBe(false)
  })

  it('rolls at the cap', () => {
    expect(shouldRoll(MAX_LOG_BYTES)).toBe(true)
    expect(shouldRoll(MAX_LOG_BYTES + 1)).toBe(true)
  })

  it('keeps one generation, so a crash loop cannot fill a disk', () => {
    // `renameSync` onto an existing `.1` replaces it. Two files, ever.
    expect(MAIN).toContain("renameSync(path, path + '.1')")
  })

  it('still writes the line when the roll fails', () => {
    /*
     * The append is outside the rename's try. A log that refused to record
     * anything because it could not tidy itself would be the failure mode
     * with the worst timing possible: it only bites once things are already
     * going wrong.
     */
    const note = MAIN.slice(MAIN.indexOf('const note = '), MAIN.indexOf('let toldAboutTrouble'))
    expect(note.indexOf('appendFileSync')).toBeGreaterThan(note.indexOf('renameSync'))
    expect(note).toContain('catch')
  })
})

describe('a line always says something', () => {
  it('carries the time, the label and the detail', () => {
    const line = diagnosticLine(new Date('2026-09-15T10:00:00.000Z'), 'start', 'Locust 0.138.0')
    expect(line).toBe('2026-09-15T10:00:00.000Z start: Locust 0.138.0\n')
  })

  it('never writes a blank detail, which reads as a truncated file', () => {
    expect(diagnosticLine(new Date(), 'x', '   ')).toContain('(no detail)')
  })
})

describe('the crashes the main process cannot throw', () => {
  /*
   * These are `app`-level, so they cover every window including the loading
   * screen without either of them knowing about it.
   */
  it('records a renderer that died', () => {
    expect(MAIN).toContain("app.on('render-process-gone'")
    expect(MAIN).toContain("note('render-process-gone'")
  })

  it('records a child process that died', () => {
    expect(MAIN).toContain("app.on('child-process-gone'")
  })

  it('records a window that stopped answering, and that it came back', () => {
    expect(MAIN).toContain("note('unresponsive'")
    expect(MAIN).toContain("note('responsive'")
  })

  it('does not log a window being closed on purpose', () => {
    // A log full of `clean-exit` is a log nobody reads.
    const gone = MAIN.slice(MAIN.indexOf("app.on('render-process-gone'"), MAIN.indexOf("app.on('child-process-gone'"))
    expect(gone).toContain("details.reason === 'clean-exit'")
    expect(gone).toContain('return')
  })

  it('says what a death was, in words and in the raw token', () => {
    // The prose is for whoever opens the file first; the token is for
    // whoever wrote the code.
    expect(describeGone({ reason: 'oom' })).toContain('ran out of memory')
    expect(describeGone({ reason: 'oom' })).toContain('reason=oom')
    expect(describeGone({ reason: 'crashed', exitCode: 133 })).toContain('exitCode=133')
  })

  it('does not pretend to recognise a reason it does not', () => {
    const said = describeGone({ reason: 'something-new' })
    expect(said).toContain('unrecognised')
    expect(said).toContain('reason=something-new')
  })
})

describe('every run says which version it was', () => {
  it('names the build, the platform and whether it was packaged', () => {
    const detail = startupDetail({
      version: '0.138.0',
      platform: 'win32',
      release: '10.0.19045',
      electron: '44.0.0',
      packaged: true
    })
    expect(detail).toContain('0.138.0')
    expect(detail).toContain('win32')
    expect(detail).toContain('packaged')
  })

  it('distinguishes a development run, which reports different bugs', () => {
    expect(startupDetail({ version: '0', platform: 'x', release: 'y', electron: 'z', packaged: false }))
      .toContain('development')
  })

  it('is built from no path, at the call site where a path could get in', () => {
    /*
     * This file exists to be handed to someone else, so the first line of
     * every log must not carry a username. Asserted against the CALL rather
     * than against `diagnostics.ts` -- a first version of this test grepped
     * the module's source for `getPath` and failed on the sentence in its
     * own doc comment explaining why `getPath` values are absent. A guard
     * that reads prose is a guard that fails for reasons unrelated to the
     * thing it guards.
     *
     * The call site is also where a regression would actually happen: the
     * module takes five named fields and cannot invent a path, but whoever
     * next adds a field to that object could hand it one.
     */
    const call = MAIN.slice(MAIN.indexOf("note('start', startupDetail({"))
    const object = call.slice(0, call.indexOf('}))'))
    expect(object).not.toContain('getPath')
    expect(object).not.toContain('workspace')
    expect(object).not.toContain('homedir')
    // What it MAY carry, so the guard fails loudly if the line is gutted.
    expect(object).toContain('app.getVersion()')
  })
})

describe('nothing is uploaded, which the app says on screen', () => {
  it('starts the crash reporter with uploading off', () => {
    /*
     * Not a default being restated. Settings tells a person "Every mission is
     * recorded to an append-only ledger on this machine. Nothing is
     * uploaded." A crash reporter that phoned home would make that sentence
     * false.
     */
    expect(MAIN).toContain('crashReporter.start({ uploadToServer: false })')
    expect(SCREENS).toContain('Nothing is uploaded.')
  })

  it('starts it before the app is ready, since a startup crash is one worth catching', () => {
    expect(MAIN.indexOf('crashReporter.start')).toBeLessThan(MAIN.indexOf('void app.whenReady()'))
  })
})

describe('a person can find the log before they need it', () => {
  it('has a place in Settings that says what to send', () => {
    expect(SCREENS).toContain('Report a problem')
    expect(SCREENS).toContain('Show the log')
  })

  it('says what is in it, because sending a file is a decision', () => {
    expect(SCREENS).toContain('what happened, never what was said')
  })

  it('reveals rather than opens', () => {
    // `reveal-file.ts` sets this rule out at length: the app never hands a
    // path to the OS and lets it decide what running it means.
    expect(MAIN).toContain('shell.showItemInFolder(errorLog())')
  })

  it('takes no path from the renderer at all', () => {
    /*
     * `workspace:reveal` must check the renderer's path against the folders
     * a mission ran in, because there the renderer proposes a destination.
     * Here the host already knows the only answer, so the strongest form of
     * "the renderer names no destinations" is a channel with no argument.
     */
    const handler = MAIN.slice(MAIN.indexOf('ipcMain.handle(DIAGNOSTICS_REVEAL_CHANNEL'))
    expect(handler.slice(0, 80)).toContain('() =>')
  })
})
