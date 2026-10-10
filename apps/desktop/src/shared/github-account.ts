/**
 * YOUR GITHUB, CONNECTED (0.720).
 *
 * Colin, 2026-10-10, of t3code's Settings › Source Control: "do we have a
 * way for the user to integrate or connect their github the way they do? ...
 * a legitimate github connector and their logo would be very cool". Locust
 * already commits, pushes and opens pull requests through the person's own
 * GitHub CLI (folder-commit.ts), but nothing showed whether it was signed in,
 * and signing in meant a terminal.
 *
 * The account is the GitHub CLI's own, never a second one: Locust keeps no
 * token. It asks `gh auth status --json hosts` who is signed in, and signs in
 * with `gh auth login --web`, which, MEASURED 2026-10-10 on gh 2.96.0 with no
 * terminal attached, prints a one-time code and the device page and then
 * waits for GitHub to say yes. The code is shown on the card; the person
 * enters it on GitHub's own page, in their own browser.
 */

export const GITHUB_ACCOUNT_CHANNEL = 'locust:github-account'
export const GITHUB_SIGN_IN_CHANNEL = 'locust:github-sign-in'
export const GITHUB_SIGN_IN_CANCEL_CHANNEL = 'locust:github-sign-in-cancel'
/** main -> renderer: the one-time code, once gh has printed it. */
export const GITHUB_SIGN_IN_CODE_CHANNEL = 'locust:github-sign-in-code'

/** Where the GitHub CLI comes from, for a computer without it. */
export const GITHUB_CLI_PAGE = 'https://cli.github.com/'
/** The only page a sign-in code is entered on. */
export const GITHUB_DEVICE_PAGE = 'https://github.com/login/device'

export type GithubAccount =
  /** No `gh` on this computer. */
  | { readonly kind: 'no-cli' }
  | { readonly kind: 'signed-out' }
  /** gh holds an account whose sign-in GitHub no longer takes. */
  | { readonly kind: 'expired'; readonly login?: string }
  | { readonly kind: 'signed-in'; readonly login: string; readonly scopes: readonly string[] }
  /** gh answered with something Locust could not read. */
  | { readonly kind: 'unknown'; readonly message: string }

export interface GithubSignInCode {
  readonly code: string
  readonly url: string
}

export type GithubSignInResult =
  | { readonly ok: true; readonly account: GithubAccount }
  | { readonly ok: false; readonly message: string }

/** Install from the card (0.724). `getItYourself`: the card then offers GitHub's own download page. */
export type GithubInstallResult =
  | { readonly ok: true; readonly account: GithubAccount }
  | { readonly ok: false; readonly message: string; readonly getItYourself: boolean }

export const GITHUB_INSTALL_CHANNEL = 'locust:github-install'

/** A GitHub login: letters, digits and single hyphens, as GitHub allows. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

/** `gh auth status --json hosts` -> who is signed in to github.com. */
export function githubAccountOf(json: string): GithubAccount {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { kind: 'unknown', message: 'The GitHub CLI answered in a way Locust could not read.' }
  }
  const hosts = typeof parsed === 'object' && parsed !== null ? (parsed as { hosts?: unknown }).hosts : undefined
  if (typeof hosts !== 'object' || hosts === null) return { kind: 'unknown', message: 'The GitHub CLI answered in a way Locust could not read.' }
  const entries = (hosts as Record<string, unknown>)['github.com']
  const accounts = Array.isArray(entries) ? entries.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null) : []
  if (accounts.length === 0) return { kind: 'signed-out' }
  const active = accounts.find((entry) => entry.active === true) ?? accounts[0]!
  const login = typeof active.login === 'string' && LOGIN.test(active.login) ? active.login : undefined
  if (active.state !== 'success' || login === undefined) return login === undefined ? { kind: 'expired' } : { kind: 'expired', login }
  const scopes = typeof active.scopes === 'string' ? active.scopes.split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0) : []
  return { kind: 'signed-in', login, scopes }
}

/**
 * gh's plain `auth status`, for a gh too old for `--json`: its exit says
 * whether anyone is signed in, and its first account line names who.
 */
export function githubAccountOfText(text: string, signedIn: boolean): GithubAccount {
  if (!signedIn) return { kind: 'signed-out' }
  const login = /Logged in to github\.com (?:account|as) ([A-Za-z0-9-]+)/.exec(text)?.[1]
  return login !== undefined && LOGIN.test(login) ? { kind: 'signed-in', login, scopes: [] } : { kind: 'unknown', message: 'The GitHub CLI says it is signed in but did not say as whom.' }
}

/** The one-time code and the page gh printed, once both have arrived; GitHub's own device page only. */
export function githubSignInCodeOf(text: string): GithubSignInCode | undefined {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(text)?.[1]
  const url = /(https:\/\/github\.com\/login\/device)\b/.exec(text)?.[1]
  return code === undefined || url === undefined ? undefined : { code, url }
}

/** What the card says, in a line. */
export function githubAccountLine(account: GithubAccount): string {
  switch (account.kind) {
    case 'no-cli':
      return 'The GitHub CLI is not on this computer. Install it here, then sign in.'
    case 'signed-out':
      return 'Not signed in. Sign in so teammates can push and open pull requests as you.'
    case 'expired':
      return `${account.login === undefined ? 'Your GitHub sign-in' : `The sign-in for ${account.login}`} no longer works. Sign in again.`
    case 'signed-in':
      // The card's name already says who: the line says what it means.
      return 'Signed in to GitHub. Teammates push and open pull requests as you.'
    case 'unknown':
      return account.message
  }
}
