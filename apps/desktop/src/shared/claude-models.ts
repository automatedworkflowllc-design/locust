/**
 * WHAT A CLAUDE CODE ALIAS MEANS, AND HOW A CLAUDE MODEL READS.
 *
 * Claude Code takes an alias -- `fable`, `opus`, `sonnet`, `haiku` -- and
 * resolves it itself, to the newest model of that family. So the picker said
 * only that ("Newest opus model"): the real name arrives with a finished run,
 * and nobody had run one. Colin, 2026-09-22: *"can we have the model type
 * listed for claude? right now it just shows opus latest model, fable latest
 * model"* -- and on 2026-09-11 he had already written the chip he wanted:
 * *"Claude / Fable 5.1"*.
 *
 * Claude Code carries its own answer. The model registry compiled into the
 * CLI maps each alias to a default, per provider; Claude Code 2.1.280, the
 * version on this machine on 2026-09-22, reads
 *
 *   aliases: { opus:   { default: "claude-opus-5-5" },
 *              sonnet: { default: "claude-sonnet-5" },
 *              haiku:  { default: "claude-haiku-4-5" },
 *              fable:  { default: "claude-fable-5-1" } }
 *
 * and the one alias measured by a real run agrees (`--model haiku` ran as
 * claude-haiku-4-5-20251001). So this is the runtime's own table, copied at
 * build time -- not a guess -- and a finished run's report still wins per
 * route: an alias that has run shows what it ran as. That matters because the
 * same registry maps some aliases elsewhere on other providers (a gateway's
 * `opus` is claude-opus-4-7), and the first run there corrects the name.
 */
export const CLAUDE_ALIAS_DEFAULTS: Readonly<Record<string, string>> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5'
}

/**
 * THE OLDER VERSIONS, for anyone who wants one on purpose.
 *
 * Colin, 2026-09-22: *"will the user be able to choose older models if theyd
 * like or are we limited to newest models?"*, then *"folded claude models is
 * great, accessible but not crowding"*. Claude Code takes a model's full name
 * as readily as an alias, and its own registry (2.1.280) names what it knows:
 * each entry below is its id there, newest first, with the effort levels its
 * capabilities list (`effort` gives low, medium and high; `xhigh_effort` and
 * `max_effort` add the rest). The alias targets are not repeated.
 *
 * Left out on purpose: the Claude 3 generation, which Anthropic has retired,
 * and the registry's `mythos` family, which only the first-party API lists
 * and no alias points at -- a version nobody can be sure runs is a row that
 * fails. Opus 4 and 4.1 and Sonnet 4 are left out for the same reason.
 */
export interface ClaudeOlderModel {
  readonly id: string
  readonly efforts: readonly string[]
}

const FIVE = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const FOUR = ['low', 'medium', 'high', 'max'] as const

export const CLAUDE_OLDER_MODELS: readonly ClaudeOlderModel[] = [
  { id: 'claude-opus-5', efforts: FIVE },
  { id: 'claude-opus-4-8', efforts: FIVE },
  { id: 'claude-opus-4-7', efforts: FIVE },
  { id: 'claude-opus-4-6', efforts: FOUR },
  { id: 'claude-opus-4-5', efforts: [] },
  { id: 'claude-fable-5', efforts: FIVE },
  { id: 'claude-sonnet-4-6', efforts: FOUR },
  { id: 'claude-sonnet-4-5', efforts: [] }
]

/**
 * `claude-opus-5-5` reads `Opus 5.5`, `claude-haiku-4-5-20251001` reads
 * `Haiku 4.5`, `claude-sonnet-5` reads `Sonnet 5`.
 *
 * Only the shape Claude's ids actually have -- family, major, an optional
 * minor, an optional date stamp and provider suffix. Anything else is not
 * guessed at: it answers undefined and the caller keeps its own spelling.
 */
export function claudeModelName(id: string): string | undefined {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d+)?$/.exec(id)
  if (match === null) return undefined
  const family = match[1] ?? ''
  const major = match[2] ?? ''
  const minor = match[3]
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

/**
 * What a Claude route's model reads as: what a finished run on it reported,
 * else what Claude Code's own table says the alias means, else undefined.
 */
export function claudeRouteModelName(model: string, earned?: string): string | undefined {
  if (earned !== undefined) {
    const named = claudeModelName(earned)
    if (named !== undefined) return named
  }
  return claudeModelName(CLAUDE_ALIAS_DEFAULTS[model] ?? model)
}
