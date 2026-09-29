import { describe, expect, it } from 'vitest'

import { startAppServerProcess } from './app-server-process.js'
import type { AppServerChild } from './app-server-process.js'

/**
 * A DYING SERVER SAYS WHY (QA-2026-09-29 round 2, N10).
 *
 * The server's stderr was not piped at all, so a Codex or OpenCode server
 * that died mid-answer was reported in the app's own words. It is drained
 * now, always -- a full pipe stalls a chatty CLI -- and only its end is kept.
 */
describe("an app server's stderr", () => {
  it('is drained, and its end kept', () => {
    let emit: (chunk: Buffer | string) => void = () => undefined
    const child: AppServerChild = {
      pid: 1,
      stdin: { write: () => true },
      stdout: { on: () => undefined },
      stderr: { on: (_event, listener) => { emit = listener } },
      on: () => undefined,
      kill: () => true
    }
    const server = startAppServerProcess('codex', ['app-server'], { spawn: () => child, releaseTree: async () => true, platform: 'linux' })
    // A chatty server: far more than is kept.
    for (let line = 0; line < 2_000; line += 1) emit(`noise line ${String(line)}\n`)
    emit('Error: sandbox could not start\n')
    const tail = server.stderrTail()
    expect(tail.length).toBeLessThanOrEqual(4_096)
    expect(tail.trim().split('\n').at(-1)).toBe('Error: sandbox could not start')
  })

  it('is empty, not missing, for a child that has none', () => {
    const child: AppServerChild = { pid: 1, stdin: { write: () => true }, stdout: { on: () => undefined }, on: () => undefined, kill: () => true }
    expect(startAppServerProcess('codex', ['app-server'], { spawn: () => child, releaseTree: async () => true, platform: 'linux' }).stderrTail()).toBe('')
  })
})
