/**
 * ONE DECISION PATH (0.616; the PRD's R8 and its A2).
 *
 * Every request a run raises -- Claude Code's permission host, Codex's
 * app-server, OpenCode, Copilot -- comes through `decide` before a card is
 * drawn, and the answer says who decided, so the record can too.
 *
 * Before this, each host kept its own "Always". Claude Code's permission host
 * remembered a TOOL for the run, so an Always on one Bash card covered every
 * command after it, and it answered those itself, before the saved rules or
 * the reach classifier were consulted. A rule the person had saved to say no
 * was walked past by an Always pressed on something else, and a command that
 * stops every python.exe, which the card says is asked about every time
 * (0.598), ran with no card once Bash had been allowed. Copilot's run did the
 * same for an exact command, and OpenCode for its own patterns.
 *
 * Now the hosts remember nothing: each request carries the key an Always on
 * it would remember (`alwaysKey`), the main process keeps the run's keys, and
 * the order is fixed here:
 *
 *   1. A question is never governed: the person answers it.
 *   2. A saved rule that says no: denied, whatever was allowed before.
 *   3. A saved rule that says yes: allowed.
 *   4. An Always pressed earlier in this run that covers it: allowed --
 *      except a command that reaches other programs, which asks again.
 *   5. Anything else: the card asks.
 *
 * Codex carries an exact-command or sorted-file-path key too, and is told
 * "once", so its next request comes here. A request naming neither keeps
 * Codex's own session Always because Locust cannot identify what it covers.
 *
 * Pure: no store, no clock. The main process reads the rules and the run's
 * keys and applies the answer.
 */
import { decideByRules, reachOfRequest, ruledActionOf } from './approval-rules.js'
import type { ApprovalRule, RuleContext } from './approval-rules.js'

/** Who answered, besides the person on the card: a rule they saved, or their own Always earlier in the run. */
export type DecidedBy = 'saved-rule' | 'earlier-always'

export type Decision =
  | { readonly verdict: 'allow' | 'deny'; readonly by: 'saved-rule'; readonly rule: ApprovalRule }
  | { readonly verdict: 'allow'; readonly by: 'earlier-always' }
  /** The card asks. `why`, when the person would wonder why they are being asked at all. */
  | { readonly verdict: 'ask'; readonly why?: string }

export interface DecisionContext extends RuleContext {
  readonly rules: readonly ApprovalRule[]
  /** An Always the person pressed on an earlier card of this run covers this request. */
  readonly remembered: boolean
}

/** A request as the hosts raise it: the fields `ruledActionOf` reads, and its kind. */
export type DecidedRequest = Parameters<typeof ruledActionOf>[0]

export function decide(request: DecidedRequest, context: DecisionContext): Decision {
  // 1. A question is answered, never allowed or denied by anything but the person.
  if (request.kind === 'question') return { verdict: 'ask' }
  // 2 and 3. The rules decide first, deny before allow (approval-rules.ts).
  const ruled = decideByRules(ruledActionOf(request), context.rules, context)
  if (ruled.decision !== 'ask') return { verdict: ruled.decision, by: 'saved-rule', rule: ruled.rule }
  // 4. An earlier Always, but never for a command that reaches other programs.
  if (context.remembered) {
    const reach = reachOfRequest(request)
    if (reach === undefined) return { verdict: 'allow', by: 'earlier-always' }
    return { verdict: 'ask', why: `Asked again, though you chose Always earlier in this run: this command ${reach.short}, and such a command is asked about every time.` }
  }
  // 5. The card.
  return ruled.why === undefined ? { verdict: 'ask' } : { verdict: 'ask', why: ruled.why }
}

/**
 * The keys of the Always answers given in each run, held by the main process.
 * A key is the host's: a tool for Claude Code (`claude:Bash`), an exact
 * command or set of files for Codex and Copilot, OpenCode's own patterns. A run id is
 * never reused, so a finished run's keys answer nothing again; the memory is
 * bounded instead of told when runs end, the least recently used run going
 * first. A key past the bound is not kept: that run is asked again.
 */
export interface RunAlways {
  readonly has: (runId: string, key: string) => boolean
  readonly add: (runId: string, key: string) => void
  readonly remove: (runId: string, key: string) => void
}

export function createRunAlways(maxRuns = 64, maxKeys = 256): RunAlways {
  const runs = new Map<string, Set<string>>()
  return {
    has: (runId, key) => runs.get(runId)?.has(key) ?? false,
    add: (runId, key) => {
      const keys = runs.get(runId) ?? new Set<string>()
      if (keys.size >= maxKeys) return
      keys.add(key)
      runs.delete(runId)
      runs.set(runId, keys)
      while (runs.size > maxRuns) runs.delete(runs.keys().next().value!)
    },
    remove: (runId, key) => {
      runs.get(runId)?.delete(key)
    }
  }
}
