import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { RUNTIME_ENVIRONMENT_ALLOWLIST } from '@teammate/runtime-adapters'

import { NO_CWD_SEARCH, refuseExecutablesFromTheWorkingFolder } from './no-planted-executables.js'

/**
 * H1: A git.exe PLANTED IN A REPOSITORY IS NEVER RUN.
 *
 * Measured, not argued: a copy of Windows' whoami.exe is saved as git.exe in
 * a folder, and `git --version` is run by bare name with that folder as the
 * working directory -- first with Windows' default search, which finds the
 * planted one; then with the switch Locust sets at start, which finds git.
 */
const onWindows = process.platform === 'win32'
const folders: string[] = []
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})
const run = (cwd: string): Promise<string> =>
  new Promise((resolve) => {
    execFile('git', ['--version'], { cwd, windowsHide: true }, (error, stdout) => resolve(error === null ? stdout : `failed: ${error.message}`))
  })

describe('a bare `git` in a folder that holds a git.exe', () => {
  it.runIf(onWindows)('runs the planted one by default, and real git once the switch is set', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'locust-planted-'))
    folders.push(folder)
    await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(folder, 'git.exe'))
    const was = process.env[NO_CWD_SEARCH]
    try {
      delete process.env[NO_CWD_SEARCH]
      // The attack, as Windows allows it: the planted program answers.
      expect(await run(folder)).not.toMatch(/^git version/)
      refuseExecutablesFromTheWorkingFolder()
      expect(await run(folder)).toMatch(/^git version/)
    } finally {
      if (was === undefined) delete process.env[NO_CWD_SEARCH]
      else process.env[NO_CWD_SEARCH] = was
    }
  })

  it('is refused for every run too: the switch is in the runners\u2019 environment', () => {
    expect(RUNTIME_ENVIRONMENT_ALLOWLIST).toContain(NO_CWD_SEARCH.toUpperCase())
  })

  it('is set by importing the module, which index.ts does before anything else', async () => {
    const index = await import('node:fs').then((fs) => fs.readFileSync(new URL('./index.ts', import.meta.url), 'utf8'))
    const firstImport = index.split('\n').find((line) => line.startsWith('import '))
    expect(firstImport).toBe("import './no-planted-executables.js'")
  })
})
