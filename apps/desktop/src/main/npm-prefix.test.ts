import { describe, expect, it } from 'vitest'

import { npmBinDirectoryFor, readNpmBinDirectory } from './npm-prefix.js'

/**
 * A runtime installed into a moved npm prefix must still be findable.
 *
 * The locator's install-root table names npm's DEFAULT prefix, so it only
 * finds an npm-installed runtime if nobody has moved it. Moving it is
 * ordinary: corporate Windows where the default folder is not writable, every
 * nvm-style version manager, and — the one that makes this a self-inflicted
 * defect — **the remedy Locust itself prints** when an install fails on
 * permissions, which is `npm config set prefix`.
 *
 * So the app could tell someone to move their prefix, watch them do it, watch
 * the install succeed, and then report the runtime as not installed. The
 * person is sent to install a thing they have just installed.
 */

describe('the bin directory for an npm prefix', () => {
  it('is the prefix itself on Windows', () => {
    // npm puts its shims directly in the prefix on Windows, beside
    // node_modules. Appending `bin` would point discovery at a directory that
    // does not exist, which looks exactly like the runtime being absent.
    expect(npmBinDirectoryFor('C:\\Users\\a\\AppData\\Local\\npm-global', 'win32')).toBe(
      'C:\\Users\\a\\AppData\\Local\\npm-global'
    )
  })

  it('is <prefix>/bin everywhere else', () => {
    expect(npmBinDirectoryFor('/home/a/.npm-global', 'linux')).toBe('/home/a/.npm-global/bin')
    expect(npmBinDirectoryFor('/usr/local', 'darwin')).toBe('/usr/local/bin')
  })

  it('refuses an empty prefix rather than returning a bare bin path', () => {
    // `join('', 'bin')` is `bin`, a RELATIVE path, and a relative search root
    // resolves against whatever directory the app happened to start in.
    expect(npmBinDirectoryFor('', 'linux')).toBeUndefined()
    expect(npmBinDirectoryFor('   ', 'win32')).toBeUndefined()
  })
})

describe('asking npm where its prefix is', () => {
  it('reads the path npm printed', async () => {
    expect(
      await readNpmBinDirectory({ platform: 'win32', run: async () => 'C:\\npm-global\r\n' })
    ).toBe('C:\\npm-global')
  })

  it('takes the first line and trims it', async () => {
    // npm prints the value alone, but a machine with a noisy profile can add
    // to the stream. The first line is the answer.
    expect(
      await readNpmBinDirectory({ platform: 'linux', run: async () => '/opt/npm\nnpm notice something\n' })
    ).toBe('/opt/npm/bin')
  })

  it('answers undefined when npm says null', async () => {
    // What npm prints for a config it does not have. A directory called
    // "null" is not a place to look for anything.
    expect(await readNpmBinDirectory({ platform: 'linux', run: async () => 'null\n' })).toBeUndefined()
    expect(await readNpmBinDirectory({ platform: 'linux', run: async () => 'undefined\n' })).toBeUndefined()
    expect(await readNpmBinDirectory({ platform: 'linux', run: async () => '\n' })).toBeUndefined()
  })

  it('answers undefined when npm cannot be asked at all', async () => {
    /*
     * A machine with no npm is not a machine with a broken Locust. Every
     * failure — absent, non-zero, timed out — has to land here rather than
     * throwing into startup, because this runs before the window exists.
     */
    expect(
      await readNpmBinDirectory({
        platform: 'linux',
        run: async () => {
          throw new Error('spawn npm ENOENT')
        }
      })
    ).toBeUndefined()
  })
})
