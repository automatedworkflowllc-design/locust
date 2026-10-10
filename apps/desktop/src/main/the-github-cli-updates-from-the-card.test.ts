import { describe, expect, it } from 'vitest'

import { githubCliIsBehind } from '../shared/github-account.js'
import { WINGET_GH_UPGRADE_ARGS, createGithubAccount, type GhAnswer } from './github-account.js'

/*
 * THE GITHUB CLI UPDATES FROM THE CARD (0.726). Colin, 2026-10-10, of this machine's gh 2.96.0 when 2.102.0 fixes
 * four security issues: "the user should be able to update anyway". The shapes below are gh's own, MEASURED that
 * day: `gh --version` -> "gh version 2.96.0 (2026-07-02)", and `gh api repos/cli/cli/releases/latest --jq
 * .tag_name` -> "v2.102.0". The package manager is stood in for; nothing is updated here.
 */
const answer = (code: GhAnswer['code'], stdout = ''): GhAnswer => ({ code, stdout, stderr: '' })
const gh = (latest: GhAnswer) => async (args: readonly string[]): Promise<GhAnswer> =>
  args[0] === '--version' ? answer(0, 'gh version 2.96.0 (2026-07-02)\nhttps://github.com/cli/cli/releases/tag/v2.96.0\n') : args[0] === 'api' ? latest : answer(0, '{"hosts":{}}')

describe('which GitHub CLI this is', () => {
  it('reads its version, and the newest GitHub has released', async () => {
    expect(await createGithubAccount({ runGh: gh(answer(0, 'v2.102.0\n')) }).versions()).toEqual({ installed: '2.96.0', latest: '2.102.0' })
  })

  it('leaves the newest unsaid when GitHub could not be asked, and asks again next time', async () => {
    let asked = 0
    const account = createGithubAccount({
      runGh: async (args) => {
        if (args[0] === 'api') asked += 1
        return args[0] === 'api' ? answer(1) : gh(answer(0))(args)
      }
    })
    expect(await account.versions()).toEqual({ installed: '2.96.0' })
    await account.versions()
    expect(asked).toBe(2)
  })

  it('says nothing for a computer with no GitHub CLI', async () => {
    expect(await createGithubAccount({ runGh: async () => answer('missing') }).versions()).toEqual({})
  })

  it('is behind only when GitHub has a higher number', () => {
    expect(githubCliIsBehind({ installed: '2.96.0', latest: '2.102.0' })).toBe(true)
    expect(githubCliIsBehind({ installed: '2.102.0', latest: '2.102.0' })).toBe(false)
    expect(githubCliIsBehind({ installed: '3.0.0', latest: '2.102.0' })).toBe(false)
    expect(githubCliIsBehind({ installed: '2.96.0' })).toBe(false)
    expect(githubCliIsBehind(undefined)).toBe(false)
  })
})

describe('updating it from the card', () => {
  it('runs winget’s upgrade of GitHub’s own package on Windows, and Homebrew’s on a Mac', async () => {
    const ran: string[][] = []
    const runInstaller = async (command: string, args: readonly string[]): Promise<GhAnswer> => {
      ran.push([command, ...args])
      return answer(0)
    }
    expect((await createGithubAccount({ platform: 'win32', runInstaller, runGh: gh(answer(0)) }).update()).ok).toBe(true)
    expect((await createGithubAccount({ platform: 'darwin', exists: (path) => path === '/usr/local/bin/brew', runInstaller, runGh: gh(answer(0)) }).update()).ok).toBe(true)
    expect(ran).toEqual([
      ['winget', ...WINGET_GH_UPGRADE_ARGS],
      ['/usr/local/bin/brew', 'upgrade', 'gh']
    ])
    expect(WINGET_GH_UPGRADE_ARGS.slice(0, 3)).toEqual(['upgrade', '--id', 'GitHub.cli'])
  })

  it('says why when it could not update', async () => {
    const result = await createGithubAccount({ platform: 'win32', runInstaller: async () => ({ code: 1, stdout: 'The installer was cancelled by the user.\n', stderr: '' }), runGh: gh(answer(0)) }).update()
    expect(result).toEqual({ ok: false, message: 'The GitHub CLI was not updated: The installer was cancelled by the user.', getItYourself: true })
  })
})
