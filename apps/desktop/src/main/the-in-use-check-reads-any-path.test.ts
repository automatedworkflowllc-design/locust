import { spawn } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import { processesUsing } from './runtime-updates.js'

/**
 * L13 (the code review): the Windows check for an agent still in use read
 * PowerShell's output in the console's OEM code page and compared it with a
 * UTF-8 path, so a folder with any non-ASCII letter never matched -- an agent
 * running from `C:\Users\José\...` read as not in use, and was updated under
 * its own feet. A real process, with such a folder on its command line.
 */
describe.skipIf(process.platform !== 'win32')('the in-use check', () => {
  it('finds a process whose path has a non-ASCII letter', async () => {
    const folder = 'C:' + String.fromCharCode(92) + 'locust-in-use-caf' + String.fromCharCode(0xe9) + '-check'
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)', folder + String.fromCharCode(92) + 'agent.js'], { stdio: 'ignore' })
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(await processesUsing(folder)).toBe(true)
    } finally {
      child.kill()
    }
  }, 60_000)
})
