/**
 * Routines that ask for inputs (W7, docs/PLAN-2026-10-03-EXECUTE.md).
 *
 * From the survey's first idea (Goose recipes), as Locust's own format: a
 * routine declares what it needs to be told -- a topic, a long note, one of a
 * few choices, a folder -- and its steps say where each answer goes with
 * `{{key}}`. Running by hand asks for the values; a run that starts on its own
 * uses the defaults and refuses, in words, when a required input has none.
 *
 * Everything here is pure, so the store, the runner, the dialog and the file
 * format all answer the same question the same way.
 */

export type RoutineInputKind = 'text' | 'long-text' | 'choice' | 'folder'

export interface RoutineInput {
  /** What a step writes between braces: `{{topic}}`. */
  readonly key: string
  /** What a person is asked, in their words. */
  readonly label: string
  readonly kind: RoutineInputKind
  readonly required: boolean
  /** Filled in for the person, and what a run on its own uses. Never on a folder. */
  readonly default?: string
  /** The answers a `choice` offers; only a choice has them. */
  readonly choices?: readonly string[]
}

export const MAX_INPUTS = 12
/** Each value a run substitutes, in characters (plan W7 step 2). */
export const MAX_INPUT_VALUE = 4_000
export const MAX_INPUT_LABEL = 80
export const MAX_CHOICES = 12
export const MAX_CHOICE_LENGTH = 80
export const INPUT_KEY = /^[a-z][a-z0-9_]{0,31}$/
export const INPUT_KINDS: readonly RoutineInputKind[] = ['text', 'long-text', 'choice', 'folder']
export const INPUT_FIELDS: readonly string[] = ['key', 'label', 'kind', 'required', 'default', 'choices']

/** The same characters a saved step may not hold; a tab and a newline are text. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const LINE_BREAK_OR_CONTROL = /[\u0000-\u001f\u007f]/
/** An absolute path, Windows or POSIX. */
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\/)/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Why one input cannot be kept, in words, or undefined when it can. */
function inputRefusal(value: unknown, at: number): string | undefined {
  const where = `Input ${String(at + 1)}`
  if (!isRecord(value)) return `${where} is not an input.`
  const stray = Object.keys(value).find((field) => !INPUT_FIELDS.includes(field))
  if (stray !== undefined) return `${where} has a field Locust does not keep: ${stray}.`
  const { key, label, kind, required } = value
  if (typeof key !== 'string' || !INPUT_KEY.test(key)) {
    return `${where} needs a key of lower-case letters, digits and underscores, starting with a letter, at most 32 long.`
  }
  if (typeof label !== 'string' || label.trim().length === 0 || label.trim().length > MAX_INPUT_LABEL || LINE_BREAK_OR_CONTROL.test(label)) {
    return `Input "${key}" needs a label of one line, at most ${String(MAX_INPUT_LABEL)} characters.`
  }
  if (typeof kind !== 'string' || !INPUT_KINDS.includes(kind as RoutineInputKind)) {
    return `Input "${key}" is not a text, long-text, choice or folder.`
  }
  if (typeof required !== 'boolean') return `Input "${key}" must say whether it is required.`
  const choices = value.choices
  if (kind === 'choice') {
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > MAX_CHOICES) {
      return `Input "${key}" is a choice, so it needs 2 to ${String(MAX_CHOICES)} answers to choose from.`
    }
    if (choices.some((choice) => typeof choice !== 'string' || choice.trim().length === 0 || choice.length > MAX_CHOICE_LENGTH || LINE_BREAK_OR_CONTROL.test(choice))) {
      return `Each answer of "${key}" must be one line, at most ${String(MAX_CHOICE_LENGTH)} characters.`
    }
    if (new Set(choices as readonly string[]).size !== choices.length) return `"${key}" lists the same answer twice.`
  } else if (choices !== undefined) {
    return `Input "${key}" is not a choice, so it has no answers to choose from.`
  }
  const given = value.default
  if (given !== undefined) {
    if (kind === 'folder') return `Input "${key}" is a folder, and a folder only comes from the folder picker, so it has no default.`
    if (typeof given !== 'string' || given.length > MAX_INPUT_VALUE || CONTROL.test(given)) {
      return `The default of "${key}" must be text of at most ${String(MAX_INPUT_VALUE)} characters.`
    }
    if (kind === 'text' && /[\n\r]/.test(given)) return `The default of "${key}" is one line; use a long-text input for several.`
    if (kind === 'choice' && !(choices as readonly string[]).includes(given)) return `The default of "${key}" is not one of its answers.`
  }
  return undefined
}

/** The `{{key}}` markers one step holds, in order, repeats included. */
export function placeholdersIn(step: string): readonly string[] {
  return [...step.matchAll(/\{\{([^{}]*)\}\}/g)].map((found) => found[1]!.trim())
}

/** Keys the steps write that no input declares, each once. */
export function undeclaredPlaceholders(steps: readonly string[], inputs: readonly RoutineInput[] | undefined): readonly string[] {
  const declared = new Set((inputs ?? []).map((input) => input.key))
  return [...new Set(steps.flatMap(placeholdersIn))].filter((key) => !declared.has(key))
}

/**
 * Whether these are inputs the store will keep: at most MAX_INPUTS, one entry
 * per key, each with exactly the fields an input has. The words for a refusal
 * come from `inputsRefusal`.
 */
export function validInputs(value: unknown): value is readonly RoutineInput[] {
  return inputsRefusal(value) === undefined
}

/**
 * Why these inputs cannot be kept -- and, when the steps are given, why they
 * do not match them -- or undefined. `{{key}}` in a step must be declared:
 * a placeholder nobody fills in would reach the model as the literal braces.
 */
export function inputsRefusal(value: unknown, steps?: readonly string[]): string | undefined {
  if (!Array.isArray(value)) return 'Inputs must be a list.'
  if (value.length > MAX_INPUTS) return `A routine asks for at most ${String(MAX_INPUTS)} inputs.`
  const seen = new Set<string>()
  for (const [at, entry] of value.entries()) {
    const refusal = inputRefusal(entry, at)
    if (refusal !== undefined) return refusal
    const key = (entry as RoutineInput).key
    if (seen.has(key)) return `Two inputs are called "${key}"; each key can be declared once.`
    seen.add(key)
  }
  if (steps === undefined) return undefined
  const missing = undeclaredPlaceholders(steps, value as readonly RoutineInput[])
  if (missing.length === 0) return undefined
  const first = steps.findIndex((step) => placeholdersIn(step).includes(missing[0] as string))
  return `Step ${String(first + 1)} uses {{${missing[0] as string}}}, which is not declared as an input. Add an input with the key ${missing[0] as string}, or take the braces out.`
}

/** A copy a store can keep: fields named one by one, an unset one left out. */
export function keptInputs(inputs: readonly RoutineInput[]): readonly RoutineInput[] {
  return inputs.map((input) => ({
    key: input.key,
    label: input.label.trim(),
    kind: input.kind,
    required: input.required,
    ...(input.default === undefined ? {} : { default: input.default }),
    ...(input.choices === undefined ? {} : { choices: [...input.choices] })
  }))
}

export type RoutineValues = Readonly<Record<string, string>>

/** Why one value cannot be substituted, in words, or undefined when it can. */
function valueRefusal(input: RoutineInput, value: string): string | undefined {
  if (value.length > MAX_INPUT_VALUE) {
    return `"${input.label}" is ${value.length.toLocaleString('en-US')} characters; an input can be at most ${MAX_INPUT_VALUE.toLocaleString('en-US')}.`
  }
  if (CONTROL.test(value)) return `"${input.label}" holds a character that cannot be sent.`
  if (input.kind === 'text' && /[\n\r]/.test(value)) return `"${input.label}" is one line; use more than one line only where the routine asks for long text.`
  if (input.kind === 'choice' && !(input.choices ?? []).includes(value)) return `"${value.slice(0, 60)}" is not one of the answers to "${input.label}".`
  if (input.kind === 'folder' && !ABSOLUTE.test(value)) return `"${input.label}" must be a folder chosen with the folder picker.`
  return undefined
}

export type ResolvedValues =
  | { readonly ok: true; readonly values: RoutineValues }
  | { readonly ok: false; readonly message: string }

/**
 * Settle every input's value for one run.
 *
 * `given` is what a person entered; absent, nobody was asked -- a run that
 * starts on its own -- and the defaults stand. A required input with neither
 * refuses the run, saying which and how to fix it. Nothing here starts
 * anything, so a refusal costs nothing.
 */
export function resolveValues(inputs: readonly RoutineInput[], given: unknown): ResolvedValues {
  const byHand = given !== undefined
  if (byHand && !isRecord(given)) return { ok: false, message: 'The values for this routine could not be read.' }
  const entered: Record<string, unknown> = byHand ? given : {}
  const stray = Object.keys(entered).find((key) => !inputs.some((input) => input.key === key))
  if (stray !== undefined) return { ok: false, message: `This routine does not ask for "${stray}".` }
  const values: Record<string, string> = {}
  for (const input of inputs) {
    const said = Object.hasOwn(entered, input.key) ? entered[input.key] : undefined
    if (said !== undefined && typeof said !== 'string') return { ok: false, message: `The value of "${input.label}" must be text.` }
    // A blank answer is no answer: the default stands, or the input is missing.
    const value = said !== undefined && said.trim().length > 0 ? said : input.default
    if (value === undefined || value.trim().length === 0) {
      if (!input.required) {
        values[input.key] = ''
        continue
      }
      return {
        ok: false,
        message: byHand
          ? `"${input.label}" needs a value before this routine can run.`
          : `This routine asks for "${input.label}", which has no default, so it cannot start on its own. Open it and set a default, or run it by hand.`
      }
    }
    const refusal = valueRefusal(input, value)
    if (refusal !== undefined) return { ok: false, message: refusal }
    values[input.key] = value
  }
  return { ok: true, values }
}

/**
 * Fill the steps in. One pass, as text: a value that itself contains
 * `{{another}}` is not substituted again, and nothing is ever handed to a
 * shell. A marker that no input declares (a routine saved before this) stays
 * exactly as it was typed.
 */
export function substituteSteps(steps: readonly string[], values: RoutineValues): readonly string[] {
  return steps.map((step) =>
    step.replace(/\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? (values[key] as string) : whole))
  )
}
