import { describe, expect, it } from 'vitest'

import { startAppServerProcess } from './app-server-process.js'

/**
 * L4 (the code review): the app-server child had no 'error' listener, so a
 * spawn that failed -- a CLI moved or deleted since discovery -- raised an
 * uncaught exception in the main process, and nothing reported the exit, so
 * the turn waited out its 60 s. Its stderr was piped and never read, so a
 * chatty CLI could fill the pipe and stall.
 */
describe('an app-server that cannot start', () => {
  it('reports the failure as its exit, and throws nothing', async () => {
    const server = startAppServerProcess('C:/nowhere/locust-no-such-codex.exe', ['app-server'])
    const exited = await new Promise<boolean>((resolve) => {
      server.onExit(() => resolve(true))
      setTimeout(() => resolve(false), 5_000)
    })
    expect(exited).toBe(true)
    // A write after the failure goes nowhere, without throwing either.
    expect(() => server.write('{}\n')).not.toThrow()
  })
})
