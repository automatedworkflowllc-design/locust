import { MAX_INPUTS, inputsRefusal, keptInputs } from '../shared/routine-inputs.js'
import type { RoutineInput } from '../shared/routine-inputs.js'
import type { PublicRoutine, RoutineFlaggedPath } from '../shared/ipc.js'
import { stepsTooLongToSave, validRoutineName, validSteps } from './routine-store.js'

/**
 * A routine as a file (W7, docs/PLAN-2026-10-03-EXECUTE.md): `<name>.locust-routine.json`.
 *
 * What travels is what a routine IS -- its steps, what it asks for, the kind of
 * route it was made for and the connectors its steps name. What belongs to one
 * person's machine does not: no teammate, workspace or mission ids (`learnedFrom`),
 * no run counts, schedules, staged changes or execution state. A file is
 * written from an explicit list of fields, never by copying the routine, so a
 * field added to routines later does not leak into a file until someone decides
 * it should.
 */

export const ROUTINE_FILE_FORMAT = 'locust-routine'
export const ROUTINE_FILE_VERSION = 1
/** Exactly the keys a routine file may carry, and the only ones an import accepts. */
export const ROUTINE_FILE_KEYS = ['format', 'version', 'name', 'steps', 'inputs', 'handOffs', 'route', 'connectors'] as const
export const MAX_ROUTINE_FILE_BYTES = 512 * 1024
const MAX_CONNECTORS = 24

export interface RoutineFile {
  readonly format: typeof ROUTINE_FILE_FORMAT
  readonly version: typeof ROUTINE_FILE_VERSION
  readonly name: string
  readonly steps: readonly string[]
  readonly inputs: readonly RoutineInput[]
  /**
   * One per step. The ROLE of whoever took it where it was made -- never a
   * teammate's id -- and whether this step is the one that checks the work.
   */
  readonly handOffs: readonly { readonly role?: string; readonly check?: true }[]
  readonly route: { readonly runtime?: string }
  /** Connectors the steps name, so an import can say which this machine lacks. */
  readonly connectors: readonly string[]
}

/** A path a step names that would mean nothing -- or too much -- on another machine. */
const PATH_TOKEN = /(["'`])((?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^"'`\r\n]+)\1|(?<=^|[\s(=[<])((?:[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^\s"'`<>|*?()]*)/gm

/** The absolute paths the steps name, by step (counting from 1), trailing punctuation left off. */
export function absolutePathsIn(steps: readonly string[]): readonly RoutineFlaggedPath[] {
  return steps.flatMap((step, at) =>
    [...step.matchAll(PATH_TOKEN)].map((found) => ({ step: at + 1, path: found[2] ?? found[3]!.replace(/[.,;:!]+$/, '') }))
  )
}

/**
 * The steps and inputs with each absolute path turned into a text input
 * (`path`, `path_2`, ...): a path may name a file as well as a folder.
 * What the file carries when the person says
 * "make it an input". The same path is the same input wherever it appears.
 */
export function pathsAsInputs(steps: readonly string[], inputs: readonly RoutineInput[]):
  { readonly ok: true; readonly steps: readonly string[]; readonly inputs: readonly RoutineInput[] } | { readonly ok: false; readonly message: string } {
  const made: RoutineInput[] = [...inputs]
  const keyOf = new Map<string, string>()
  const free = (): string => {
    for (let number = 1; ; number += 1) {
      const key = number === 1 ? 'path' : `path_${String(number)}`
      if (!made.some((input) => input.key === key)) return key
    }
  }
  const next = steps.map((step) =>
    step.replace(PATH_TOKEN, (_whole: string, quote: string | undefined, quoted: string | undefined, bare: string | undefined) => {
      const path = quoted ?? bare!.replace(/[.,;:!]+$/, '')
      const tail = quoted === undefined ? bare!.slice(path.length) : ''
      let key = keyOf.get(path)
      if (key === undefined) {
        key = free()
        keyOf.set(path, key)
        made.push({ key, label: key === 'path' ? 'Path' : `Path ${key.replace('path_', '')}`, kind: 'text', required: true })
      }
      return `${quote ?? ''}{{${key}}}${quote ?? ''}${tail}`
    })
  )
  if (made.length > MAX_INPUTS) return { ok: false, message: `That would be ${String(made.length)} inputs; a routine asks for at most ${String(MAX_INPUTS)}.` }
  return { ok: true, steps: next, inputs: made }
}

/** Each connector (of those this machine has) that a step names, by its name, ignoring case. */
export function connectorsNamedIn(steps: readonly string[], names: readonly string[]): readonly string[] {
  const text = steps.join('\n').toLowerCase()
  const escaped = (name: string): string => name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...new Set(names)].filter((name) => name.length > 0 && new RegExp(`(?<![a-z0-9_-])${escaped(name)}(?![a-z0-9_-])`).test(text))
}

/**
 * The file for a routine. `steps` and `inputs` are given so the caller can pass
 * the version where paths became inputs. Fields are named one by one.
 */
export function routineToFile(
  routine: PublicRoutine,
  using: {
    readonly steps: readonly string[]
    readonly inputs: readonly RoutineInput[]
    /** A teammate's role by id, for a step handed to someone else. */
    readonly roleOf: (teammateId: string) => string | undefined
    /** The connectors this machine has. */
    readonly connectorNames: readonly string[]
  }
): RoutineFile {
  return {
    format: ROUTINE_FILE_FORMAT,
    version: ROUTINE_FILE_VERSION,
    name: routine.name,
    steps: [...using.steps],
    inputs: keptInputs(using.inputs),
    handOffs: using.steps.map((_, at) => {
      const entry = routine.handOffs?.[at]
      const who = entry?.teammateId
      // A chain says its roles for every step, the routine's own teammate's too, so another Locust can propose someone for each.
      const chain = routine.handOffs?.some((held) => held.check === true) === true
      const named = who === undefined || who === routine.teammateId ? (chain ? routine.teammateId : undefined) : who
      const role = named === undefined ? undefined : using.roleOf(named)
      return { ...(role === undefined ? {} : { role }), ...(entry?.check === true ? { check: true as const } : {}) }
    }),
    route: { runtime: routine.route.runtime },
    connectors: connectorsNamedIn(using.steps, using.connectorNames)
  }
}

/** The text of the file: the same bytes every time for the same routine. */
export function routineFileText(file: RoutineFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** `<name>.locust-routine.json`, with a name any file system takes. */
export function routineFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60)
  return `${plain.length > 0 ? plain : 'routine'}.locust-routine.json`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
// eslint-disable-next-line no-control-regex
const ONE_LINE = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

export type RoutineFileRead = { readonly ok: true; readonly file: RoutineFile } | { readonly ok: false; readonly message: string }

/**
 * Read a routine file, refusing anything that is not exactly one: another
 * format, another version, a field this Locust does not keep, a step or an
 * input it would not save. Nothing here creates a routine.
 */
export function parseRoutineFile(text: string): RoutineFileRead {
  const refuse = (message: string): RoutineFileRead => ({ ok: false, message })
  if (Buffer.byteLength(text, 'utf8') > MAX_ROUTINE_FILE_BYTES) return refuse('That file is too large to be a routine.')
  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return refuse('That file is not a routine: it is not readable JSON.')
  }
  if (!isRecord(value)) return refuse('That file is not a routine.')
  if (value.format !== ROUTINE_FILE_FORMAT) {
    return refuse(typeof value.format === 'string' && value.format.length <= 40 ? `That file is a "${value.format}" file, not a Locust routine.` : 'That file is not a Locust routine.')
  }
  if (value.version !== ROUTINE_FILE_VERSION) {
    return refuse(typeof value.version === 'number' ? `That routine file is version ${String(value.version)}; this Locust reads version ${String(ROUTINE_FILE_VERSION)}.` : 'That routine file has no version this Locust reads.')
  }
  const stray = Object.keys(value).find((key) => !(ROUTINE_FILE_KEYS as readonly string[]).includes(key))
  if (stray !== undefined) return refuse(`That routine file has a field Locust does not read (${stray.slice(0, 40)}), so it was not opened.`)
  const missing = ROUTINE_FILE_KEYS.find((key) => !Object.hasOwn(value, key))
  if (missing !== undefined) return refuse(`That routine file is missing its ${missing} field.`)
  const { name, steps, inputs, handOffs, route, connectors } = value
  if (!validRoutineName(name)) return refuse('That routine has no usable name.')
  if (!validSteps(steps)) return refuse('That routine\'s steps are not ones Locust can keep: 1 to 12 steps, none empty.')
  const tooLong = stepsTooLongToSave(steps)
  if (tooLong !== undefined) return refuse(tooLong)
  const asked = inputs === undefined ? [] : inputs
  const saying = inputsRefusal(asked, steps)
  if (saying !== undefined) return refuse(`That routine's inputs are not ones Locust can keep. ${saying}`)
  if (!Array.isArray(handOffs) || handOffs.length !== steps.length
    || !handOffs.every((entry) => isRecord(entry) && Object.keys(entry).every((key) => key === 'role' || key === 'check') && (entry.role === undefined || ONE_LINE(entry.role, 60)) && (entry.check === undefined || entry.check === true))) {
    return refuse('That routine\'s hand-offs do not line up with its steps.')
  }
  if (!isRecord(route) || Object.keys(route).some((key) => key !== 'runtime') || (route.runtime !== undefined && !(typeof route.runtime === 'string' && /^[a-z0-9-]{1,40}$/.test(route.runtime)))) {
    return refuse('That routine\'s route is not one Locust can read.')
  }
  if (!Array.isArray(connectors) || connectors.length > MAX_CONNECTORS || !connectors.every((entry) => ONE_LINE(entry, 80))) {
    return refuse('That routine\'s list of connectors is not one Locust can read.')
  }
  return {
    ok: true,
    file: {
      format: ROUTINE_FILE_FORMAT,
      version: ROUTINE_FILE_VERSION,
      name: name.trim(),
      steps: [...steps],
      inputs: keptInputs(asked as readonly RoutineInput[]),
      handOffs: (handOffs as readonly { readonly role?: string; readonly check?: true }[]).map((entry) => ({ ...(entry.role === undefined ? {} : { role: entry.role }), ...(entry.check === true ? { check: true as const } : {}) })),
      route: route.runtime === undefined ? {} : { runtime: route.runtime as string },
      connectors: [...(connectors as readonly string[])]
    }
  }
}
