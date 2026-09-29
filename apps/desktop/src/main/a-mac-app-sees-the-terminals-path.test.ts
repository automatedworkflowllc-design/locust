import { describe, expect, it } from 'vitest'

import { loginShellPath, macPath, mergedPath } from './mac-path.js'

/**
 * A MAC APP SEES THE TERMINAL'S PATH (the first macOS build, 2026-09-29).
 * Opened from the Dock, an app gets /usr/bin:/bin:/usr/sbin:/sbin, and the
 * locator searches PATH only there: every CLI would read "not installed".
 */
describe('the PATH Locust runs with', () => {
  it('on macOS puts the login shell\'s PATH first, then what it was given, then the usual install folders', () => {
    const path = macPath('darwin', '/usr/bin:/bin:/usr/sbin:/sbin', { shell: '/bin/zsh', home: '/Users/ian', ask: () => '/opt/homebrew/bin:/Users/ian/.npm-global/bin:/usr/bin' })
    const parts = path!.split(':')
    expect(parts.slice(0, 3)).toEqual(['/opt/homebrew/bin', '/Users/ian/.npm-global/bin', '/usr/bin'])
    expect(parts).toContain('/Users/ian/.local/bin')
    expect(parts).toContain('/usr/local/bin')
    expect(new Set(parts).size).toBe(parts.length)
  })

  it('still finds the usual folders when the shell cannot be asked', () => {
    const path = macPath('darwin', '/usr/bin:/bin', { home: '/Users/ian', ask: () => undefined })
    expect(path).toContain('/opt/homebrew/bin')
    expect(path!.startsWith('/usr/bin:/bin:')).toBe(true)
  })

  it('is left alone on Windows and Linux', () => {
    expect(macPath('win32', 'C:\\Windows', { ask: () => '/nope' })).toBe('C:\\Windows')
    expect(macPath('linux', '/usr/bin', { ask: () => '/nope' })).toBe('/usr/bin')
  })

  it("reads only what is between the markers, whatever a shell profile prints", () => {
    const said = loginShellPath('/bin/zsh', () => 'Welcome back!\n__LOCUST_PATH__/opt/homebrew/bin:/usr/bin__LOCUST_PATH__')
    expect(said).toBe('/opt/homebrew/bin:/usr/bin')
    expect(loginShellPath('/bin/zsh', () => { throw new Error('timed out') })).toBeUndefined()
  })

  it('merges without repeats or empty entries', () => {
    expect(mergedPath('/a:/b', '/b::/c', undefined)).toBe('/a:/b:/c')
  })
})
