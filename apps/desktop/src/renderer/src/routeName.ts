import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import { modelLabelFor } from './status.js'
import { runtimeDisplayName } from '../../shared/runtimes.js'

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
