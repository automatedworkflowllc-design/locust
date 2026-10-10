import { describe, expect, it } from 'vitest'

import { WINGET_GH_ARGS, createGithubAccount, ghCommand, type GhAnswer } from './github-account.js'

/*
 * INSTALL THE GITHUB CLI FROM THE CARD (0.724). The plan for Connect GitHub said a missing GitHub CLI is
 * installed from the button; 0.719 linked to its download page instead. The package manager is stood in for
 * here: on the machine this was built on gh was already installed, and Locust never reinstalls or upgrades it.
 */
const SIGNED_OUT = '{"hosts":{}}'
const answer = (code: GhAnswer['code'], stdout = ''): GhAnswer => ({ code, stdout, stderr: '' })

/** An account whose gh is missing until the installer has run. */
const after = (installer: (command: string, args: readonly string[]) => GhAnswer, platform: NodeJS.Platform, exists: (path: string) => boolean = () => false) => {
  const ran: string[][] = []
  let installed = false
  const account = createGithubAccount({
    platform,
    exists,
    runGh: async () => (installed ? answer(0, SIGNED_OUT) : answer('missing')),
    runInstaller: async (command, args) => {
      ran.push([command, ...args])
      const result = installer(command, args)
      if (result.code === 0) installed = true
      return result
    }
  })
  return { account, ran, installedAnyway: () => (installed = true) }
}

describe('installing the GitHub CLI from the card', () => {
  it('uses winget on Windows, GitHub’s own package, and then asks gh who is signed in', async () => {
    const { account, ran } = after(() => answer(0), 'win32')
    expect(await account.install()).toEqual({ ok: true, account: { kind: 'signed-out' } })
    expect(ran).toEqual([['winget', ...WINGET_GH_ARGS]])
    expect(WINGET_GH_ARGS).toContain('GitHub.cli')
    expect(WINGET_GH_ARGS).toContain('--exact')
  })

  it('takes winget’s “already installed” as gh being there', async () => {
    const run = after(() => answer(-1978335135), 'win32')
    run.installedAnyway()
    expect(await run.account.install()).toEqual({ ok: true, account: { kind: 'signed-out' } })
  })

  it('uses Homebrew on a Mac that has it, and offers GitHub’s page on one that does not', async () => {
    const brewed = after(() => answer(0), 'darwin', (path) => path === '/opt/homebrew/bin/brew')
    expect((await brewed.account.install()).ok).toBe(true)
    expect(brewed.ran).toEqual([['/opt/homebrew/bin/brew', 'install', 'gh']])
    const bare = after(() => answer(0), 'darwin')
    expect(await bare.account.install()).toMatchObject({ ok: false, getItYourself: true })
    expect(bare.ran).toEqual([])
    expect(await after(() => answer(0), 'linux').account.install()).toMatchObject({ ok: false, getItYourself: true })
  })

  it('says why when the installer is missing or fails, and offers GitHub’s page', async () => {
    expect(await after(() => answer('missing'), 'win32').account.install()).toEqual({ ok: false, message: 'winget is not on this computer, so Locust cannot install it for you.', getItYourself: true })
    expect(await after(() => ({ code: 1, stdout: 'Installer failed with exit code: 1602\n', stderr: '' }), 'win32').account.install()).toEqual({
      ok: false,
      message: 'The GitHub CLI was not installed: Installer failed with exit code: 1602',
      getItYourself: true
    })
  })

  it('finds a gh installed while Locust runs, where its installer put it', () => {
    const fresh = 'C:\\Program Files\\GitHub CLI\\gh.exe'
    expect(ghCommand('win32', { PATH: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }, (path) => path === fresh)).toBe(fresh)
    expect(ghCommand('win32', { PATH: 'C:\\tools', ProgramFiles: 'C:\\Program Files' }, (path) => path === 'C:\\tools\\gh.exe')).toBe('gh')
    expect(ghCommand('darwin', { PATH: '/usr/bin' }, (path) => path === '/opt/homebrew/bin/gh')).toBe('/opt/homebrew/bin/gh')
    // Nowhere: plain `gh`, whose ENOENT says it is missing.
    expect(ghCommand('win32', { PATH: '' }, () => false)).toBe('gh')
  })
})
