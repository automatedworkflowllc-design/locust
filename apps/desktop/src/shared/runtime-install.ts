import type { MissionRuntimeId } from '@teammate/runtime-adapters'

/**
 * How a person gets each runtime onto their machine.
 *
 * Until now a runtime Locust could not find said only "<name> was not found on
 * this machine. Install it and sign in; Locust finds it on its own." That is
 * true and it is a dead end: it names the problem and leaves the person to go
 * and search for the answer, which is the wall anyone opening Locust for the
 * first time hits before they have seen it do anything.
 *
 * Everything here was MEASURED on a machine that has them all (2026-09-06) by
 * reading where each executable actually lives and which package owns it,
 * rather than copied from documentation that may have moved on:
 *
 *   claude, codex, copilot, opencode -> %APPDATA%\npm  (global npm installs)
 *   cursor-agent                     -> %LOCALAPPDATA%\cursor-agent, its own
 *                                       updater, versioned directories
 *
 * So four of the five are one npm command, and Cursor is not; its install
 * script is not recorded anywhere on disk afterwards, so this points at
 * Cursor's own page instead of inventing a command line for it.
 */

export type RuntimeInstall =
  | { readonly kind: 'npm'; readonly packageName: string }
  | { readonly kind: 'vendor'; readonly url: string }

export interface RuntimeInstallFacts {
  readonly install: RuntimeInstall
  /**
   * What the person runs once to sign in, when signing in is a separate step.
   * Absent when the runtime needs no account at all.
   */
  readonly signIn?: string
  /**
   * What the account is, in the person's terms. Absent means none is needed --
   * which is true of exactly one of them, and it is the whole on-ramp.
   */
  readonly account?: string
}

/**
 * OpenCode is the only one that runs with no account.
 *
 * Measured, not assumed: `opencode auth list` reports **0 credentials** on this
 * machine, and every drive in this repo runs on its free model
 * (`opencode/muse-spark-1.3-contributor-free`). One npm install and there is a
 * working teammate -- no sign-in, no key, no subscription. That makes it the
 * one path worth putting in front of someone who has installed Locust and has
 * nothing else, and everything below is what they add afterwards if they want
 * a stronger model.
 */
export const FREE_START_RUNTIME: MissionRuntimeId = 'opencode'

const FACTS: Readonly<Record<string, RuntimeInstallFacts | undefined>> = {
  opencode: { install: { kind: 'npm', packageName: 'opencode-ai' } },
  claude: {
    install: { kind: 'npm', packageName: '@anthropic-ai/claude-code' },
    signIn: 'claude',
    account: 'an Anthropic account'
  },
  codex: {
    install: { kind: 'npm', packageName: '@openai/codex' },
    signIn: 'codex',
    account: 'a ChatGPT account'
  },
  copilot: {
    install: { kind: 'npm', packageName: '@github/copilot' },
    signIn: 'copilot',
    account: 'a GitHub Copilot subscription'
  },
  cursor: {
    // Not npm. It installs to %LOCALAPPDATA%\cursor-agent and updates itself
    // into versioned folders; the installer leaves nothing behind that names
    // the command that ran it, so this does not guess at one.
    install: { kind: 'vendor', url: 'https://cursor.com/cli' },
    signIn: 'cursor-agent login',
    account: 'a Cursor account'
  },
  /*
   * Not npm, and not a plain download either.
   *
   * Muse Code 1.3.0 (2026-09) ships a native Windows build -- before that it
   * was WSL-only, which is why Locust did not carry it. The installer is a
   * PowerShell script from Meta and it puts `muse.exe` under
   * %LOCALAPPDATA%\Programs\muse, which is on the same kind of path
   * discovery already walks for cursor-agent.
   *
   * Pointed at the vendor rather than given a command line, for the reason
   * Cursor is: a script we do not own can change, and a command we print is
   * a command a person will run.
   */
  muse: {
    install: { kind: 'vendor', url: 'https://dev.meta.ai' },
    signIn: 'muse login',
    account: 'a Muse Code subscription'
  },
  // Antigravity CLI (`agy`, 0.540): what Locust runs when it is installed;
  // its page has the one-line installer. Without it, the app route.
  antigravity: { install: { kind: 'vendor', url: 'https://antigravity.google/product/antigravity-cli/' } },
  // Found and signed into like the others, but no mission can run under it --
  // its event stream has never been captured. Nothing to offer to install.
  gemini: undefined
}

/**
 * Takes any runtime id the UI holds, not just the ones a mission can run
 * under: the settings list also carries `omniroute`, which is a way of
 * choosing a route rather than a thing to install. An id with nothing to
 * install answers undefined, and every caller draws nothing.
 */
export function runtimeInstallFacts(runtime: string): RuntimeInstallFacts | undefined {
  return FACTS[runtime]
}

/** The exact line to run, for a runtime that installs from npm. */
export function installCommand(runtime: string): string | undefined {
  const facts = FACTS[runtime]
  if (facts === undefined || facts.install.kind !== 'npm') return undefined
  return `npm install -g ${facts.install.packageName}`
}

/**
 * One sentence for a runtime Locust cannot find, saying what to do rather than
 * only what is wrong. Deliberately short: it sits under a row in a list.
 */
export function installSentence(runtime: string, displayName: string): string {
  const facts = FACTS[runtime]
  if (facts === undefined) return `${displayName} was not found on this machine.`
  if (facts.install.kind === 'vendor') {
    return `${displayName} was not found on this machine. It installs from ${facts.install.url}.`
  }
  // "Then run codex..." read as a dangling clause when the command sits on the
  // line below rather than in the sentence (drive, 2026-09-06). The sentence
  // has to stand on its own and point at what follows it.
  const after = facts.signIn === undefined
    ? 'Press Install -- no account and no sign-in; its free model runs as soon as it is there.'
    : `Press Install, then run ${facts.signIn} once to sign in with ${facts.account ?? 'your account'}.`
  return `${displayName} was not found on this machine. ${after}`
}

/**
 * The line a person runs once to sign in, when the runtime needs an account.
 *
 * Lives beside the facts rather than in the first-run panel, because the
 * first-run panel is not the only place a person meets a signed-out runtime.
 * Settings drew the same red SIGN IN tag and said nothing else at all, so the
 * screen a person opens when something is wrong knew LESS than the screen
 * they see once (Grok's audit, 2026-09-13).
 */
export function signInCommand(runtime: string): string | undefined {
  const facts = runtimeInstallFacts(runtime)
  return facts?.signIn === undefined ? undefined : `run ${facts.signIn}`
}
