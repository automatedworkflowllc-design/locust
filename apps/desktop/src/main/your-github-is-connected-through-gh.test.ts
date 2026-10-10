import { describe, expect, it } from 'vitest'

import { githubAccountLine, githubAccountOf, githubAccountOfText, githubSignInCodeOf } from '../shared/github-account.js'
import { createGithubAccount, type GhAnswer, type GhLogin } from './github-account.js'

/*
 * YOUR GITHUB, CONNECTED (0.720). The shapes below are gh 2.96.0's own,
 * MEASURED 2026-10-10: `auth status --json hosts` signed in and in a fresh
 * config folder, and `auth login --web` with no terminal attached, which
 * printed its code and page and then waited. The code here is made up.
 */
const SIGNED_IN = '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"octo-cat","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}]}}'
const PRINTED = '\n! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n'

describe('who the GitHub CLI is signed in as', () => {
  it('reads the active account, its scopes, and an account GitHub no longer takes', () => {
    expect(githubAccountOf(SIGNED_IN)).toEqual({ kind: 'signed-in', login: 'octo-cat', scopes: ['gist', 'read:org', 'repo', 'workflow'] })
    expect(githubAccountOf('{"hosts":{}}')).toEqual({ kind: 'signed-out' })
    expect(githubAccountOf('{"hosts":{"github.com":[{"state":"error","active":true,"login":"octo-cat"}]}}')).toEqual({ kind: 'expired', login: 'octo-cat' })
    // Two accounts: the active one is who teammates act as.
    expect(
      githubAccountOf('{"hosts":{"github.com":[{"state":"success","active":false,"login":"old"},{"state":"success","active":true,"login":"new-one","scopes":"repo"}]}}')
    ).toEqual({ kind: 'signed-in', login: 'new-one', scopes: ['repo'] })
    expect(githubAccountOf('not json').kind).toBe('unknown')
  })

  it('never names a login GitHub could not have issued', () => {
    expect(githubAccountOf('{"hosts":{"github.com":[{"state":"success","active":true,"login":"<img src=x>"}]}}')).toEqual({ kind: 'expired' })
  })

  it('reads an older gh by its exit and first account line', () => {
    expect(githubAccountOfText('github.com\n  ✓ Logged in to github.com account octo-cat (keyring)', true)).toEqual({ kind: 'signed-in', login: 'octo-cat', scopes: [] })
    expect(githubAccountOfText('You are not logged into any GitHub hosts.', false)).toEqual({ kind: 'signed-out' })
  })

  it('takes the code only with GitHub’s own device page', () => {
    expect(githubSignInCodeOf(PRINTED)).toEqual({ code: 'AB12-CD34', url: 'https://github.com/login/device' })
    expect(githubSignInCodeOf('! First copy your one-time code: AB12-CD34\nOpen https://evil.example/login/device')).toBeUndefined()
    expect(githubSignInCodeOf('! First copy your one-time code: AB12')).toBeUndefined()
  })

  it('says each state in a line', () => {
    expect(githubAccountLine({ kind: 'signed-in', login: 'octo-cat', scopes: [] })).toBe('Signed in to GitHub. Teammates push and open pull requests as you.')
    expect(githubAccountLine({ kind: 'no-cli' })).toContain('not on this computer')
    expect(githubAccountLine({ kind: 'expired', login: 'octo-cat' })).toBe('The sign-in for octo-cat no longer works. Sign in again.')
  })
})

/** A gh login that prints what it is given and ends when told. */
function fakeLogin(): { readonly login: GhLogin; readonly asked: string[][]; print(text: string): void; end(code: number): void; readonly stopped: () => boolean } {
  const listeners: ((text: string) => void)[] = []
  let finish: (code: number | 'missing') => void = () => {}
  let stopped = false
  const ended = new Promise<number | 'missing'>((resolvePromise) => {
    finish = resolvePromise
  })
  return {
    login: {
      onText: (listener) => {
        listeners.push(listener)
      },
      ended,
      stop: () => {
        stopped = true
        finish(1)
      }
    },
    asked: [],
    print: (text) => listeners.forEach((listener) => listener(text)),
    end: (code) => finish(code),
    stopped: () => stopped
  }
}

describe('signing in without a terminal', () => {
  const answers = (...queue: GhAnswer[]) => {
    const asked: (readonly string[])[] = []
    return {
      asked,
      runGh: async (args: readonly string[]): Promise<GhAnswer> => {
        asked.push(args)
        return queue.shift() ?? { code: 1, stdout: '', stderr: '' }
      }
    }
  }

  it('asks gh by --json, and says when gh is not installed', async () => {
    const gh = answers({ code: 0, stdout: SIGNED_IN, stderr: '' })
    expect(await createGithubAccount({ runGh: gh.runGh }).read()).toMatchObject({ kind: 'signed-in', login: 'octo-cat' })
    expect(gh.asked[0]).toEqual(['auth', 'status', '--json', 'hosts', '--hostname', 'github.com'])
    expect(await createGithubAccount({ runGh: answers({ code: 'missing', stdout: '', stderr: '' }).runGh }).read()).toEqual({ kind: 'no-cli' })
  })

  it('shows the code gh prints, even split across two writes, and answers with the account once GitHub says yes', async () => {
    const fake = fakeLogin()
    let started: readonly string[] = []
    const account = createGithubAccount({
      runGh: answers({ code: 0, stdout: SIGNED_IN, stderr: '' }).runGh,
      startLogin: (args) => {
        started = args
        return fake.login
      }
    })
    const codes: unknown[] = []
    const result = account.signIn((code) => codes.push(code))
    fake.print('\n! First copy your one-time code: AB1')
    fake.print('2-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n')
    fake.print(PRINTED)
    expect(codes).toEqual([{ code: 'AB12-CD34', url: 'https://github.com/login/device' }])
    expect(started).toEqual(['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'])
    fake.end(0)
    expect(await result).toEqual({ ok: true, account: { kind: 'signed-in', login: 'octo-cat', scopes: ['gist', 'read:org', 'repo', 'workflow'] } })
  })

  it('runs one sign-in at a time, and Stop ends it', async () => {
    const fake = fakeLogin()
    const account = createGithubAccount({ runGh: answers().runGh, startLogin: () => fake.login })
    const first = account.signIn(() => {})
    expect(await account.signIn(() => {})).toEqual({ ok: false, message: 'A GitHub sign-in is already waiting. Finish it on GitHub, or stop it.' })
    account.cancel()
    expect(fake.stopped()).toBe(true)
    expect(await first).toEqual({ ok: false, message: 'Sign-in stopped.' })
  })

  it('stops waiting when the code runs out', async () => {
    const fake = fakeLogin()
    const account = createGithubAccount({ runGh: answers().runGh, startLogin: () => fake.login, signInTimeoutMs: 5 })
    expect(await account.signIn(() => {})).toEqual({ ok: false, message: 'The code ran out before GitHub was told yes. Sign in again for a new one.' })
    expect(fake.stopped()).toBe(true)
  })

  it('says what gh said when GitHub refused', async () => {
    const fake = fakeLogin()
    const account = createGithubAccount({ runGh: answers().runGh, startLogin: () => fake.login })
    const result = account.signIn(() => {})
    fake.print(PRINTED)
    fake.print('error: the device code was denied\n')
    fake.end(1)
    expect(await result).toEqual({ ok: false, message: 'GitHub did not sign you in: error: the device code was denied' })
  })
})
