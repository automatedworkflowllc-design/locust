/**
 * A window a test drive opened may start runs on free routes only.
 *
 * The rule for every drive of this app is "spend nothing you were not given":
 * OpenCode's free models, no one's paid account. It lived in comments. On
 * 2026-09-22 a design-pass sweep ran `_tools/drive-compact.mjs`, whose header
 * says "It needs no model and spends nothing" and whose body picks Cursor's
 * Grok 4.6 and sends a turn on it -- written on 2026-09-07, before the rule,
 * and never gated. One short turn on Colin's Cursor account, against the rule,
 * with nothing in the way. Twenty other drives could pick a paid route the
 * same way, and a scan of their text cannot tell which of them send.
 *
 * So the refusal lives where every run starts, not in the drives. The drive
 * harness launches the app with `LOCUST_FREE_ONLY=1` unless the drive declared
 * `spends: true` AND the person running it set `LOCUST_SPEND=1`. It only ever
 * takes something away: nothing a person runs sets it.
 */
export const FREE_ONLY_ENVIRONMENT = 'LOCUST_FREE_ONLY'

/**
 * Whether this launch is held to free routes.
 *
 * Set explicitly by the drive harness, AND implied by the switch every script
 * that drives this app launches it with. More than seventy drives and smokes
 * spawn the app themselves rather than through the harness, so an opt-in flag
 * only the harness sets would have covered a fraction of them. What they all
 * share is `--remote-debugging-port`, which is how a script takes the window
 * over -- and nobody using Locust launches it that way.
 *
 * `LOCUST_SPEND=1` lifts it: the word `assertMaySpend` already asks for, set
 * by the person running a drive that is MEANT to spend.
 */
export function freeRoutesOnly(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  if (environment.LOCUST_SPEND === '1') return false
  if (environment[FREE_ONLY_ENVIRONMENT] === '1') return true
  return argv.some((argument) => argument.startsWith('--remote-debugging-port'))
}

/** OpenCode's free models: the only routes that cost nobody anything. */
export function isFreeRoute(runtime: string, model: string | undefined): boolean {
  return runtime === 'opencode' && model !== undefined && /(^|[-/])free$|-free\b/i.test(model)
}

export const FREE_ONLY_REFUSAL =
  'This window was opened by a test drive that may only use free routes, and this route is not one. Nothing was started.'
