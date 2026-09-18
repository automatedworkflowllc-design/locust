import { describe, expect, it } from 'vitest'

import { bundledNpmPaths, findBundledNpm } from './bundled-npm.js'

/**
 * The app carries an npm, so a machine with no Node can still install a CLI.
 *
 * Ian's machine is the case: Locust's whole first screen is "install one of
 * these", and without Node every button on it was disabled.
 */

const PACKAGED = 'C:\\Program Files\\Locust\\resources'
const APP = 'C:\\Program Files\\Locust\\resources\\app.asar'
const EXEC = 'C:\\Program Files\\Locust\\Locust.exe'

describe('the npm this app carries', () => {
  it('is looked for in resources first, where a packaged build copies it whole', () => {
    // Not `app.asar.unpacked`: that shipped npm without the 118 packages it
    // bundles, because pnpm links node_modules/npm at its store and the
    // link took the folder and not the tree. Measured as "Cannot find
    // module 'graceful-fs'" on the first run with no Node on PATH.
    const [first] = bundledNpmPaths(PACKAGED, APP)
    expect(first).toBe('C:\\Program Files\\Locust\\resources\\npm\\bin\\npm-cli.js')
  })

  it('is found, and comes with the variable that makes the app behave as Node', () => {
    const found = findBundledNpm({
      resourcesPath: PACKAGED,
      appPath: APP,
      execPath: EXEC,
      exists: (path) => path.includes('resources')
    })
    expect(found?.nodePath).toBe(EXEC)
    expect(found?.cliPath).toContain('npm-cli.js')
    // Without it the same path opens a second copy of the app instead.
    expect(found?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('falls back to the workspace copy in development', () => {
    const found = findBundledNpm({
      resourcesPath: 'C:\\nope',
      appPath: 'C:\\repo\\apps\\desktop',
      execPath: EXEC,
      exists: (path) => path === 'C:\\repo\\apps\\desktop\\node_modules\\npm\\bin\\npm-cli.js'
    })
    expect(found?.cliPath).toBe('C:\\repo\\apps\\desktop\\node_modules\\npm\\bin\\npm-cli.js')
  })

  it('is nothing at all when this build shipped none, rather than a path that is not there', () => {
    // A guessed path would spawn and fail with a message about a missing
    // file, which reads as the install breaking rather than as this build
    // not carrying npm.
    expect(findBundledNpm({ resourcesPath: PACKAGED, appPath: APP, execPath: EXEC, exists: () => false })).toBeUndefined()
  })
})
