import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

import {
  githubAccountOf,
  githubAccountOfText,
  githubSignInCodeOf,
  type GithubAccount,
  type GithubCliVersions,
  type GithubInstallResult,
  type GithubSignInCode,
  type GithubSignInResult
} from '../shared/github-account.js'

/**
 * The GitHub CLI's own account, read and signed in to (shared/github-account.ts).
 * Locust holds no token: gh keeps it where gh keeps it.
 */

export interface GhAnswer {
  readonly code: number | 'missing'
  readonly stdout: string
  readonly stderr: string
}

/** A running `gh auth login`: its printed text as it comes, and how it ended. */
export interface GhLogin {
  onText(listener: (text: string) => void): void
  readonly ended: Promise<number | 'missing'>
  stop(): void
}

export interface GithubAccountOptions {
  readonly runGh?: (args: readonly string[]) => Promise<GhAnswer>
  readonly startLogin?: (args: readonly string[]) => GhLogin
  /** A device code lasts fifteen minutes on GitHub; the wait stops there too. */
  readonly signInTimeoutMs?: number
  /** Runs a package manager for Install (0.724): its exit, or `missing` when it is not there. */
  readonly runInstaller?: (command: string, args: readonly string[]) => Promise<GhAnswer>
  readonly platform?: NodeJS.Platform
  readonly exists?: (path: string) => boolean
}

/**
 * INSTALL THE GITHUB CLI FROM THE CARD (0.724), with the computer's own package manager -- winget on Windows,
 * Homebrew on a Mac that has it -- so Connect GitHub needs no terminal from the very start. Pressing Install is
 * the person's say-so for GitHub's MIT-licensed package; Windows still asks them to allow the installer.
 * MEASURED 2026-10-10 (read only): `winget show --id GitHub.cli --exact --source winget` finds "GitHub CLI
 * [GitHub.cli]", GitHub, Inc., MIT, a wix installer. The install itself was not run on this machine: its gh was
 * already there, and Locust does not reinstall or upgrade what a person has.
 */
export const WINGET_GH_ARGS = ['install', '--id', 'GitHub.cli', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'] as const
export const WINGET_GH_UPGRADE_ARGS = ['upgrade', '--id', 'GitHub.cli', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'] as const
/** winget's "already installed" and "no newer version" exits: gh is there either way. */
const WINGET_ALREADY = new Set([-1978335135, -1978335189])

function defaultRunInstaller(command: string, args: readonly string[]): Promise<GhAnswer> {
  return new Promise((resolvePromise) => {
    execFile(command, [...args], { windowsHide: true, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'ENOENT') resolvePromise({ code: 'missing', stdout: '', stderr: '' })
      else resolvePromise({ code: error === null ? 0 : typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

const QUIET_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' })

/**
 * Where gh is, PATH first. A gh installed while Locust runs is not on the PATH Locust started with, so the
 * places its installers put it are looked at too: winget's machine-wide and per-user GitHub CLI folders, and
 * Homebrew's two prefixes (0.724).
 */
export function ghCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  const { delimiter, join } = platform === 'win32' ? win32 : posix
  const onPath = (env.PATH ?? env.Path ?? '').split(delimiter).filter((dir) => dir.length > 0)
  const names = platform === 'win32' ? ['gh.exe'] : ['gh']
  for (const dir of onPath) for (const name of names) if (exists(join(dir, name))) return 'gh'
  const known =
    platform === 'win32'
      ? [
          ...(env.ProgramFiles === undefined ? [] : [join(env.ProgramFiles, 'GitHub CLI', 'gh.exe')]),
          ...(env.LOCALAPPDATA === undefined ? [] : [join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe')])
        ]
      : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']
  return known.find((path) => exists(path)) ?? 'gh'
}

function defaultRunGh(args: readonly string[]): Promise<GhAnswer> {
  return new Promise((resolvePromise) => {
    execFile(ghCommand(), [...args], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, env: QUIET_ENV() }, (error, stdout, stderr) => {
      // An exit is a number; a gh that is not there is ENOENT.
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'ENOENT') resolvePromise({ code: 'missing', stdout: '', stderr: '' })
      else resolvePromise({ code: error === null ? 0 : typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function defaultStartLogin(args: readonly string[]): GhLogin {
  const child = spawn(ghCommand(), [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: QUIET_ENV() })
  const listeners: ((text: string) => void)[] = []
  const say = (chunk: Buffer): void => {
    for (const listener of listeners) listener(chunk.toString('utf8'))
  }
  child.stdout.on('data', say)
  child.stderr.on('data', say)
  const ended = new Promise<number | 'missing'>((resolvePromise) => {
    child.on('error', (error: NodeJS.ErrnoException) => resolvePromise(error.code === 'ENOENT' ? 'missing' : 1))
    child.on('close', (code) => resolvePromise(code ?? 1))
  })
  return {
    onText: (listener) => {
      listeners.push(listener)
    },
    ended,
    stop: () => {
      if (child.exitCode === null) child.kill()
    }
  }
}

export function createGithubAccount(options: GithubAccountOptions = {}) {
  const runGh = options.runGh ?? defaultRunGh
  const startLogin = options.startLogin ?? defaultStartLogin
  const signInTimeoutMs = options.signInTimeoutMs ?? 15 * 60_000
  let running: GhLogin | undefined

  const read = async (): Promise<GithubAccount> => {
    const answer = await runGh(['auth', 'status', '--json', 'hosts', '--hostname', 'github.com'])
    if (answer.code === 'missing') return { kind: 'no-cli' }
    if (answer.code === 0 && answer.stdout.trim().startsWith('{')) return githubAccountOf(answer.stdout)
    // A gh from before `--json`: its plain status, by exit and first line.
    const plain = await runGh(['auth', 'status', '--hostname', 'github.com'])
    if (plain.code === 'missing') return { kind: 'no-cli' }
    return githubAccountOfText(`${plain.stdout}\n${plain.stderr}`, plain.code === 0)
  }

  /** One sign-in at a time; `onCode` hears the code once gh prints it. */
  const signIn = async (onCode: (code: GithubSignInCode) => void): Promise<GithubSignInResult> => {
    if (running !== undefined) return { ok: false, message: 'A GitHub sign-in is already waiting. Finish it on GitHub, or stop it.' }
    const login = startLogin(['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'])
    running = login
    let printed = ''
    let told = false
    login.onText((text) => {
      // Kept after the code too: a refusal's reason is printed last.
      printed = (printed + text).slice(-4000)
      if (told) return
      const found = githubSignInCodeOf(printed)
      if (found !== undefined) {
        told = true
        onCode(found)
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<'late'>((resolvePromise) => {
      timer = setTimeout(() => resolvePromise('late'), signInTimeoutMs)
    })
    try {
      const ended = await Promise.race([login.ended, late])
      if (ended === 'late') {
        login.stop()
        return { ok: false, message: 'The code ran out before GitHub was told yes. Sign in again for a new one.' }
      }
      if (ended === 'missing') return { ok: false, message: 'The GitHub CLI is not on this computer.' }
      if (ended !== 0) {
        const said = printed.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && !line.includes('one-time code')).pop()
        return { ok: false, message: running === undefined ? 'Sign-in stopped.' : `GitHub did not sign you in${said === undefined ? '.' : `: ${said.slice(0, 200)}`}` }
      }
      return { ok: true, account: await read() }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      running = undefined
    }
  }

  const cancel = (): void => {
    const login = running
    running = undefined
    login?.stop()
  }

  const runInstaller = options.runInstaller ?? defaultRunInstaller
  const platform = options.platform ?? process.platform
  const exists = options.exists ?? existsSync
  let installing = false
  /**
   * One install or update at a time, with the computer's own package manager; then gh is asked again, from
   * wherever the installer put it. An update is the same run with `upgrade` (0.726).
   */
  const viaPackageManager = async (update: boolean): Promise<GithubInstallResult> => {
    const doing = update ? 'updated' : 'installed'
    if (installing) return { ok: false, message: 'The GitHub CLI is already being installed or updated.', getItYourself: false }
    installing = true
    try {
      const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((path) => exists(path))
      const how =
        platform === 'win32'
          ? { command: 'winget', args: update ? WINGET_GH_UPGRADE_ARGS : WINGET_GH_ARGS }
          : platform === 'darwin' && brew !== undefined
            ? { command: brew, args: [update ? 'upgrade' : 'install', 'gh'] as const }
            : undefined
      if (how === undefined) return { ok: false, message: `This computer has no package manager Locust can ${update ? 'update' : 'install'} it with.`, getItYourself: true }
      const ran = await runInstaller(how.command, how.args)
      if (ran.code === 'missing') return { ok: false, message: `${platform === 'win32' ? 'winget' : 'Homebrew'} is not on this computer, so Locust cannot ${update ? 'update' : 'install'} it for you.`, getItYourself: true }
      if (ran.code !== 0 && !(platform === 'win32' && WINGET_ALREADY.has(ran.code))) {
        const said = `${ran.stdout}\n${ran.stderr}`.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).pop()
        return { ok: false, message: `The GitHub CLI was not ${doing}${said === undefined ? '.' : `: ${said.slice(0, 200)}`}`, getItYourself: true }
      }
      const account = await read()
      if (account.kind === 'no-cli') return { ok: false, message: `It ${doing}, but Locust cannot find it yet. Restart Locust and it will.`, getItYourself: false }
      return { ok: true, account }
    } finally {
      installing = false
    }
  }
  const install = (): Promise<GithubInstallResult> => viaPackageManager(false)
  const update = (): Promise<GithubInstallResult> => viaPackageManager(true)

  /**
   * Which gh this is, and the newest GitHub has released (0.726): `gh --version`, and `gh api
   * repos/cli/cli/releases/latest` -- MEASURED 2026-10-10: "gh version 2.96.0 (2026-07-02)" and "v2.102.0".
   * The newest is asked of GitHub once per launch; anything unread leaves it unsaid.
   */
  let latest: Promise<string | undefined> | undefined
  const versions = async (): Promise<GithubCliVersions> => {
    const said = await runGh(['--version'])
    if (said.code === 'missing') return {}
    const installed = /gh version (\d+\.\d+\.\d+)/.exec(said.stdout)?.[1]
    latest ??= runGh(['api', 'repos/cli/cli/releases/latest', '--jq', '.tag_name']).then(
      (answer) => (answer.code === 0 ? /^v?(\d+\.\d+\.\d+)\s*$/.exec(answer.stdout.trim())?.[1] : undefined),
      () => undefined
    )
    const newest = await latest
    if (newest === undefined) latest = undefined
    return { ...(installed === undefined ? {} : { installed }), ...(newest === undefined ? {} : { latest: newest }) }
  }

  return { read, signIn, cancel, install, update, versions }
}
