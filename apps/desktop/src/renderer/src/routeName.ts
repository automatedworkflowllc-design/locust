import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import { modelLabelFor } from './status.js'
import { runtimeDisplayName } from '../../shared/runtimes.js'
import { claudeRouteModelName } from '../../shared/claude-models.js'

/**
 * How a route reads when it is CHROME rather than prose.
 *
 * The composer chip and the mission header name the same route the Settings
 * screen does, and they are not the same job. Settings is telling you which
 * program this is, so `Cursor Agent` and `Codex CLI` earn their second word.
 * A chip sitting under a text box is a label on a control you already chose;
 * the second word is filler there, and the model beside it was the raw id --
 * `Cursor Agent / cursor-grok-4.6`, which says "cursor" twice and then spells
 * a product name in lowercase with a hyphen in it.
 *
 * Colin, 2026-09-11: "this is way too much filler text, it should just say
 * Cursor / Grok 4.6, Claude / Fable 5.1, Codex / GPT-6 Astra".
 *
 * The full id is not thrown away -- it stays in the control's tooltip and in
 * the receipt, which are where a person goes to find the exact string to
 * type somewhere else.
 */

const SHORT_NAMES: Partial<Record<MissionRuntimeId, string>> = {
  codex: 'Codex',
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  copilot: 'Copilot'
}

/** `Cursor`, not `Cursor Agent`. Runtimes whose name is already one word keep it. */
export function shortRuntimeName(runtime: MissionRuntimeId): string {
  return SHORT_NAMES[runtime] ?? runtimeDisplayName(runtime)
}

/*
 * Written the way the makers write them, which is the only reason this is a
 * list rather than a rule: `GPT-4`, `GPT-5` keep the hyphen and `Grok 4`,
 * `Claude 3`, `Gemini 2.5` do not. Nothing here invents a version or a name
 * -- every word comes from the id -- so an id this does not recognise still
 * reads as itself, only spaced and capitalised.
 */
const ACRONYMS: ReadonlySet<string> = new Set(['gpt', 'cli', 'ai'])

const capitalised = (token: string): string =>
  ACRONYMS.has(token.toLowerCase()) ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)

function spellOut(id: string): string {
  const tokens = id.split('-')
  let out = ''
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (index === 0) {
      out = capitalised(token)
      continue
    }
    // `GPT-6`, but `Grok 4.6`: the hyphen survives only where the makers keep
    // one, which is between an acronym and the number that versions it.
    const previous = tokens[index - 1] ?? ''
    const keepsHyphen = ACRONYMS.has(previous.toLowerCase()) && /^[0-9]/.test(token)
    out += (keepsHyphen ? '-' : ' ') + capitalised(token)
  }
  return out
}

/**
 * `cursor-grok-4.6` beside Cursor reads `Grok 4.6`.
 *
 * Three things happen, in order, and each is a repetition being removed
 * rather than a name being invented:
 *
 *   1. A provider that merely repeats the runtime goes (`modelLabelFor`, for
 *      OpenCode's `opencode/ling-3.0-...`). A provider that does NOT repeat
 *      it is real information about whose model this is, and stays.
 *   2. A runtime that repeats itself INSIDE the id goes the same way --
 *      Cursor names every model `cursor-<model>` and the chip already says
 *      Cursor.
 *   3. What is left is spelled as a name rather than an identifier.
 */
export function modelDisplayName(runtime: string, modelId: string): string {
  const named = modelLabelFor(runtime, modelId)
  const slash = named.indexOf('/')
  if (slash > 0) {
    return `${spellOut(named.slice(0, slash))}/${spellOut(named.slice(slash + 1))}`
  }
  const prefix = `${runtime.toLowerCase()}-`
  const bare = named.toLowerCase().startsWith(prefix) ? named.slice(prefix.length) : named
  // An id that is ONLY the runtime's name has nothing left to show; the id
  // itself is then the honest label.
  return bare.length === 0 ? spellOut(named) : spellOut(bare)
}

/**
 * The model a ROUTE will run, for the controls that pick or show one: the
 * composer's chip, the picker, a teammate's route.
 *
 * For Claude Code that is the version the alias means -- `Claude / Opus 5.5`,
 * the chip Colin wrote out on 2026-09-11 (*"Claude / Fable 5.1"*) -- taken
 * from what a finished run on that route reported (`earned`) and otherwise
 * from Claude Code's own alias table. A past mission's row keeps
 * `modelDisplayName`: `opus` in August meant whatever it meant then, and
 * today's version would be a claim about a run nobody measured.
 */
export function routeModelName(runtime: string, modelId: string, earned?: string): string {
  if (runtime === 'claude') {
    const named = claudeRouteModelName(modelId, earned)
    if (named !== undefined) return named
  }
  return modelDisplayName(runtime, modelId)
}

/**
 * A model name with its trailing "Free" split off, so the route chip can draw
 * it as a tag that is never cut. The chip truncates names at 18 characters,
 * and "Muse Spark 1.3 Contributor Free" lost exactly the word that says the
 * route costs nothing (Yurt's beta report, 2026-09-23, #12).
 */
export function freeTagOf(label: string): { readonly name: string; readonly free: boolean } {
  return / free$/i.test(label) && label.length > 5 ? { name: label.slice(0, -5), free: true } : { name: label, free: false }
}
