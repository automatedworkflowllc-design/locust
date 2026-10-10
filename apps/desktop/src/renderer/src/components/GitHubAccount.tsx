import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { GITHUB_CLI_PAGE, githubAccountLine, githubCliIsBehind } from '../../../shared/github-account.js'
import { copyText } from '../copyText.js'
import type { GithubAccount as Account, GithubCliVersions, GithubSignInCode } from '../../../shared/github-account.js'

/**
 * YOUR GITHUB, ON THE CONNECTORS PAGE (0.720, shared/github-account.ts).
 *
 * Who the GitHub CLI is signed in as, and a sign-in that needs no terminal:
 * Locust starts `gh auth login --web`, shows the one-time code gh printed,
 * and one press copies it and opens GitHub's device page in the person's
 * own browser. Locust never sees a password or keeps a token.
 */

/**
 * GitHub's mark, to NAME GitHub (nominative, as runtimeMarks.ts sets out):
 * Octicons "mark-github", GitHub Primer, MIT. Bundled, never fetched.
 */
export function GitHubMark({ size = 16 }: { readonly size?: number }): ReactElement {
  return (
    <svg className="lc-githubmark" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
      />
    </svg>
  )
}

export function GitHubAccount(): ReactElement {
  const [account, setAccount] = useState<Account | undefined>(undefined)
  const [code, setCode] = useState<GithubSignInCode | undefined>(undefined)
  const [signingIn, setSigningIn] = useState(false)
  const [copied, setCopied] = useState(false)
  const [said, setSaid] = useState<string | undefined>(undefined)
  const [installing, setInstalling] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [versions, setVersions] = useState<GithubCliVersions | undefined>(undefined)

  const read = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setAccount(undefined)
    void bridge
      .githubAccount()
      .then((read) => {
        setAccount(read)
        // Which gh, and whether GitHub has a newer one (0.726): only once there is a gh to ask.
        if (read.kind !== 'no-cli') void bridge.githubCliVersions().then(setVersions, () => setVersions(undefined))
      })
      .catch(() => setAccount({ kind: 'unknown', message: 'The GitHub CLI could not be asked. Nothing was changed; Check again asks it once more.' }))
  }

  useEffect(() => {
    read()
    return window.desktop?.onGithubSignInCode((arrived) => setCode(arrived))
  }, [])

  const signIn = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setSaid(undefined)
    setCode(undefined)
    setCopied(false)
    setSigningIn(true)
    void bridge
      .githubSignIn()
      .then((result) => {
        if (result.ok) setAccount(result.account)
        else setSaid(result.message)
      })
      .catch(() => setSaid('The sign-in could not be started. Nothing was signed in or changed.'))
      .finally(() => {
        setSigningIn(false)
        setCode(undefined)
      })
  }

  const install = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setSaid(undefined)
    setInstalling(true)
    void bridge
      .githubInstall()
      .then((result) => {
        if (result.ok) setAccount(result.account)
        else setSaid(result.message)
      })
      .catch(() => setSaid('The install could not be started. Nothing was installed.'))
      .finally(() => setInstalling(false))
  }

  const update = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setSaid(undefined)
    setUpdating(true)
    void bridge
      .githubUpdate()
      .then((result) => {
        if (result.ok) {
          setAccount(result.account)
          void bridge.githubCliVersions().then(setVersions, () => setVersions(undefined))
        } else setSaid(result.message)
      })
      .catch(() => setSaid('The update could not be started. Nothing was changed.'))
      .finally(() => setUpdating(false))
  }

  const open = (url: string): void => {
    void window.desktop
      ?.openLink(url)
      .then((answer) => {
        if (!answer.ok) setSaid(answer.message)
      })
      .catch(() => setSaid('Your browser could not be opened. Nothing on this machine changed.'))
  }

  return (
    <GitHubCard
      account={account}
      signingIn={signingIn}
      code={code}
      copied={copied}
      said={said}
      installing={installing}
      onInstall={install}
      versions={versions}
      updating={updating}
      onUpdate={update}
      onRead={read}
      onSignIn={signIn}
      onStop={() => void window.desktop?.githubSignInCancel()}
      onOpen={open}
      onCopied={() => setCopied(true)}
    />
  )
}

export interface GitHubCardProps {
  /** undefined while gh is being asked. */
  readonly account: Account | undefined
  readonly signingIn: boolean
  readonly code: GithubSignInCode | undefined
  readonly copied: boolean
  readonly said: string | undefined
  /** The GitHub CLI being installed from the card (0.724). */
  readonly installing?: boolean
  readonly onInstall?: () => void
  /** Which GitHub CLI this is and the newest released, and updating it from the card (0.726). */
  readonly versions?: GithubCliVersions
  readonly updating?: boolean
  readonly onUpdate?: () => void
  readonly onRead: () => void
  readonly onSignIn: () => void
  readonly onStop: () => void
  readonly onOpen: (url: string) => void
  readonly onCopied: () => void
}

/** The card itself, from its state: what a test draws. */
export function GitHubCard({ account, signingIn, code, copied, said, installing = false, onInstall, versions, updating = false, onUpdate, onRead, onSignIn, onStop, onOpen, onCopied }: GitHubCardProps): ReactElement {
  const signedIn = account?.kind === 'signed-in'
  const busy = signingIn || installing || updating
  const behind = account !== undefined && account.kind !== 'no-cli' && githubCliIsBehind(versions)
  return (
    <div className="lc-github" data-state={signingIn ? 'signing-in' : installing ? 'installing' : updating ? 'updating' : (account?.kind ?? 'reading')}>
      <div className="lc-github__head">
        <span className={`lc-github__mark${signedIn ? ' is-on' : ''}`}>
          <GitHubMark size={20} />
        </span>
        <span className="lc-github__who">
          <span className="lc-github__name">{signedIn ? account.login : 'GitHub'}</span>
          <span className="lc-github__line">
            {signingIn
              ? 'Waiting for GitHub to say yes.'
              : installing
                ? 'Installing the GitHub CLI. Your computer may ask you to allow it.'
                : updating
                  ? 'Updating the GitHub CLI. Your computer may ask you to allow it.'
                : account === undefined
                  ? 'Asking the GitHub CLI.'
                  : githubAccountLine(account)}
          </span>
        </span>
        <span className="lc-github__actions">
          {/* Installed with the computer's own package manager (0.724); GitHub's page stays one press away. */}
          {!busy && account?.kind === 'no-cli' && onInstall !== undefined && (
            <button type="button" className="lc-primarybutton" onClick={onInstall}>
              Install the GitHub CLI
            </button>
          )}
          {!busy && account?.kind === 'no-cli' && (
            <button type="button" className={onInstall === undefined ? 'lc-primarybutton' : 'lc-button'} onClick={() => onOpen(GITHUB_CLI_PAGE)}>
              Get it from GitHub
            </button>
          )}
          {!busy && (account?.kind === 'signed-out' || account?.kind === 'expired' || account?.kind === 'unknown') && (
            <button type="button" className="lc-primarybutton" onClick={onSignIn}>
              <GitHubMark size={14} /> Sign in with GitHub
            </button>
          )}
          {!busy && signedIn && (
            <button type="button" className="lc-button" onClick={() => onOpen(`https://github.com/${account.login}`)}>
              Open on GitHub
            </button>
          )}
          {!busy && account !== undefined && (
            <button type="button" className="lc-button" onClick={onRead}>
              Check again
            </button>
          )}
          {signingIn && (
            <button type="button" className="lc-button" onClick={onStop}>
              Stop
            </button>
          )}
        </span>
      </div>
      {/* A newer GitHub CLI, said once there is one, with the update a press away (0.726). */}
      {behind && !busy && versions?.latest !== undefined && versions.installed !== undefined && (
        <div className="lc-github__code">
          <span className="lc-settings__note">
            GitHub CLI {versions.latest} is out. This computer has {versions.installed}.
          </span>
          {onUpdate !== undefined && (
            <button type="button" className="lc-button" onClick={onUpdate}>
              Update the GitHub CLI
            </button>
          )}
        </div>
      )}
      {signingIn && (
        <div className="lc-github__code" aria-live="polite">
          {code === undefined ? (
            <span className="lc-settings__note">Asking GitHub for a code.</span>
          ) : (
            <>
              <span className="lc-settings__note">Enter this code on GitHub&rsquo;s page, then come back. It lasts fifteen minutes.</span>
              <span className="lc-github__digits lc-mono">{code.code}</span>
              <button
                type="button"
                className="lc-primarybutton"
                onClick={() => {
                  void copyText(code.code)
                  onCopied()
                  onOpen(code.url)
                }}
              >
                {copied ? 'Copied. Open GitHub again' : 'Copy code and open GitHub'}
              </button>
            </>
          )}
        </div>
      )}
      {said !== undefined && <p className="lc-github__said lc-tone-amber">{said}</p>}
    </div>
  )
}
