import { describe, expect, it } from 'vitest'

import { withoutShellWrapper } from './missionView.js'

/**
 * A running step names the command, not the thing that launched it.
 *
 * Colin, 2026-09-15, on a live row reading
 * `using a tool ••• · cmd /c "dir /s /b /o-d .locust sessions backups project… · 2m 12s`:
 * *"is this working as intended with the txt there, i feel like claude code
 * portrays it cleaner usually."*
 *
 * It is right. A runtime does not run `dir /s /b`; it runs
 * `cmd /c "dir /s /b ..."`, and on Windows EVERY shell call arrives wearing
 * that prefix. So the row spent its first nine characters on a fact true of
 * every row, and the command — the only part that differs — was what got
 * ellipsised off the end.
 *
 * The wrapper is transport, the same species as `mcp__` on a connector name,
 * which this file already strips for exactly this reason.
 */

describe('the shell wrapper comes off', () => {
  it('unwraps the shape that prompted this', () => {
    expect(withoutShellWrapper('cmd /c "dir /s /b /o-d .locust sessions backups"'))
      .toBe('dir /s /b /o-d .locust sessions backups')
  })

  it('handles the spellings this app actually spawns', () => {
    expect(withoutShellWrapper('cmd.exe /c npm test')).toBe('npm test')
    expect(withoutShellWrapper('powershell -NoProfile -Command "Get-Item x"')).toBe('Get-Item x')
    expect(withoutShellWrapper('bash -lc "ls -la"')).toBe('ls -la')
    expect(withoutShellWrapper('/bin/sh -c "make"')).toBe('make')
  })

  it('leaves an ordinary command alone', () => {
    // Anything unrecognised comes back untouched. A command shown in full is
    // never wrong, only long.
    expect(withoutShellWrapper('git status')).toBe('git status')
    expect(withoutShellWrapper('npm run build')).toBe('npm run build')
  })

  it('does not strip quotes that are not a wrapper', () => {
    /*
     * The quotes come off only when they enclose the WHOLE remainder. An
     * inner quote means the outer pair is punctuation inside a larger line,
     * and removing it would change what the row says.
     */
    expect(withoutShellWrapper('cmd /c "a" && "b"')).toBe('"a" && "b"')
  })

  it('only matches at the start, so a command that mentions one is safe', () => {
    expect(withoutShellWrapper('echo run cmd /c something')).toBe('echo run cmd /c something')
  })

  it('keeps the whole thing when there is nothing after the wrapper', () => {
    // `cmd /c` alone is strange, and showing the strange thing is better than
    // showing an empty row.
    expect(withoutShellWrapper('cmd /c ')).toBe('cmd /c')
  })

  it('trims, so a row never starts with whitespace', () => {
    expect(withoutShellWrapper('   git log   ')).toBe('git log')
  })
})
