import { describe, expect, it } from 'vitest'

import { classifyInstallFailure } from './runtime-installer.js'

/**
 * A B4 lead from the code review, settled: on Windows an npm EPERM on a
 * rename or unlink is nearly always a file LOCK -- the CLI being replaced is
 * running -- and it was reported as an unwritable global folder, with a
 * remedy that moves npm's prefix. That reconfigures npm and fixes nothing.
 */
const LOCKED = [
  'npm error code EPERM',
  'npm error syscall rename',
  "npm error path C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\opencode-ai",
  "npm error errno -4048",
  "npm error Error: EPERM: operation not permitted, rename 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\opencode-ai'"
].join('\n')
const classify = (output: string, platform: NodeJS.Platform) =>
  classifyInstallFailure({ packageName: 'opencode-ai', displayName: 'OpenCode', code: 1, output, seconds: 3, platform })

describe('an npm failure on Windows', () => {
  it('names a locked file as a lock, with no prefix to move', () => {
    const said = classify(LOCKED, 'win32')
    expect(said.what).toMatch(/running program is holding OpenCode/)
    expect(said.command).toBeUndefined()
  })

  it('still names an unwritable folder as one', () => {
    expect(classify('npm error code EACCES\nnpm error Error: EACCES: permission denied, mkdir', 'win32').what).toContain('could not write to its global folder')
  })

  it('reads the same EPERM as a folder problem off Windows, where a lock does not look like this', () => {
    expect(classify(LOCKED, 'linux').what).toContain('could not write to its global folder')
  })
})
