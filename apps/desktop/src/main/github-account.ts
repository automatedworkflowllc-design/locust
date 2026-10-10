import { execFile, spawn } from 'node:child_process'

import {
  githubAccountOf,
  githubAccountOfText,
  githubSignInCodeOf,
  type GithubAccount,
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
}

const QUIET_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' })

function defaultRunGh(args: readonly string[]): Promise<GhAnswer> {
  return new Promise((resolvePromise) => {
    execFile('gh', [...args], { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024, env: QUIET_ENV() }, (error, stdout, stderr) => {
      // An exit is a number; a gh that is not there is ENOENT.
      const code = (error as { code?: unknown } | null)?.code
      if (code === 'ENOENT') resolvePromise({ code: 'missing', stdout: '', stderr: '' })
      else resolvePromise({ code: error === null ? 0 : typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function defaultStartLogin(args: readonly string[]): GhLogin {
  const child = spawn('gh', [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: QUIET_ENV() })
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

  return { read, signIn, cancel }
}
