import { spawn } from 'node:child_process'

import { killProcessTree, releaseProcessTree } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { startAppServerProcess } from './app-server-process.js'
import type { AppServerChild, AppServerProcessDeps } from './app-server-process.js'

/**
 * STOPPING AN APP-SERVER HOLDS NOTHING, AND HAPPENS ONCE.
 *
 * Both of its callers stop it twice -- a Codex turn's end, then the client's
 * transport close; the model probe's dispose, then its `finally` -- and each
 * stop was a synchronous `taskkill /T`. Measured 2026-09-22: about 79 ms
 * holding the main process for a two-process tree, and 75 ms again for the
 * tree that was already gone. The main process answers nothing meanwhile.
 */

function fakeChild(pid: number | undefined) {
  const kills: number[] = []
  const child: AppServerChild = {
    ...(pid === undefined ? {} : { pid }),
    stdin: { write: () => true },
    stdout: { on: () => undefined },
    on: () => undefined,
    kill: () => {
      kills.push(1)
      return true
    }
  }
  return { child, kills }
}

function deps(child: AppServerChild, platform: NodeJS.Platform, released: Promise<boolean> = new Promise(() => undefined)) {
  const walks: number[] = []
  const machine: AppServerProcessDeps = {
    spawn: () => child,
    releaseTree: (pid) => {
      walks.push(pid)
      return released
    },
    platform
  }
  return { machine, walks }
}

describe('stopping an app-server', () => {
  it('walks the tree once however many times it is stopped', () => {
    const { child, kills } = fakeChild(4242)
    const { machine, walks } = deps(child, 'win32')
    const server = startAppServerProcess('codex', ['app-server'], machine)
    server.kill()
    server.kill()
    server.kill()
    expect(walks).toEqual([4242])
    expect(kills).toEqual([])
  })

  it('returns before the walk finishes -- the walk never has to finish for kill() to return', () => {
    const { child } = fakeChild(4242)
    const { machine } = deps(child, 'win32')
    const server = startAppServerProcess('codex', ['app-server'], machine)
    const before = performance.now()
    server.kill()
    expect(performance.now() - before).toBeLessThan(5)
  })

  it('kills the process itself when taskkill could not', async () => {
    const { child, kills } = fakeChild(4242)
    const { machine } = deps(child, 'win32', Promise.resolve(false))
    startAppServerProcess('codex', ['app-server'], machine).kill()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(kills).toEqual([1])
  })

  it('off Windows, and without a pid, is the ordinary kill, once', () => {
    for (const [platform, pid] of [['linux', 4242], ['win32', undefined]] as const) {
      const { child, kills } = fakeChild(pid)
      const { machine, walks } = deps(child, platform)
      const server = startAppServerProcess('codex', ['app-server'], machine)
      server.kill()
      server.kill()
      expect(walks).toEqual([])
      expect(kills).toEqual([1])
    }
  })
})

/*
 * On a REAL tree, against the old synchronous call as the control. Windows
 * only: that is the platform with a taskkill, and the one where the stall was.
 */
describe.runIf(process.platform === 'win32')('on a real process tree', () => {
  const tree = async () => {
    const parent = spawn(
      process.execPath,
      ['-e', "require('child_process').spawn(process.execPath, ['-e', 'setInterval(function(){},1000)'], { stdio: 'ignore' }); setInterval(function(){}, 1000)"],
      { stdio: 'ignore' }
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
    return parent
  }
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  it('the old call holds the thread; the new one does not, and still takes the tree down', async () => {
    const old = await tree()
    const oldStart = performance.now()
    killProcessTree(old.pid)
    const oldHeld = performance.now() - oldStart

    const next = await tree()
    const nextStart = performance.now()
    const walked = releaseProcessTree(next.pid)
    const nextHeld = performance.now() - nextStart
    expect(await walked).toBe(true)
    expect(alive(next.pid!)).toBe(false)

    // The control has to show the thing being fixed, or the comparison says
    // nothing (measured 79 ms here; the bound leaves room for a fast machine).
    expect(oldHeld).toBeGreaterThan(20)
    expect(nextHeld).toBeLessThan(oldHeld / 4)
  }, 20_000)
})
