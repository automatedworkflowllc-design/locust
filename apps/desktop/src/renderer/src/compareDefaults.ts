import type { PublicModel } from '../../shared/ipc.js'
import type { ComparePick } from './components/RoutePicker.js'

type Choice = { readonly runtime: ComparePick['runtime']; readonly model: string; readonly effort?: string }

/**
 * THE TWO MODELS A COMPARISON STARTS ON (0.460).
 *
 * Arena opens Side by Side with two models already chosen, each in its own
 * dropdown; Locust opened a checklist and waited. Colin, 2026-09-29: "do what
 * arena.ai does where you can select the models with two dropdowns". So a new
 * comparison starts on two, and either is one press to change.
 *
 * Which two: the route in the message box, then the ones this person has
 * actually run, newest first, then the catalog -- only models that can join
 * (ready, not refused), never "Account default", which names no model. The
 * second is from ANOTHER runtime when there is one, because comparing two
 * makers is what a person reaches for first ("benching openai vs claude",
 * Colin, 2026-09-28). Fewer than two found, none: the picker opens instead.
 */
export function defaultComparePicks(input: {
  readonly current: Choice | undefined
  /** Routes this person ran, newest first, as `runtime:model`. */
  readonly recent: readonly string[]
  /** OpenCode's free models that finished a run here, newest first (0.517). */
  readonly answered?: readonly string[]
  readonly models: readonly PublicModel[]
  readonly ready: (runtime: string) => boolean
  readonly refusal: (choice: Choice) => string | undefined
  readonly label: (choice: Choice) => string
}): readonly ComparePick[] {
  const candidates: Choice[] = []
  const add = (choice: Choice | undefined): void => {
    if (choice === undefined || choice.model === 'account-default' || choice.model.length === 0) return
    if (candidates.some((one) => one.runtime === choice.runtime && one.model === choice.model)) return
    if (!input.ready(choice.runtime) || input.refusal(choice) !== undefined) return
    candidates.push(choice)
  }
  add(input.current)
  for (const key of input.recent) {
    const cut = key.indexOf(':')
    if (cut > 0) add({ runtime: key.slice(0, cut) as Choice['runtime'], model: key.slice(cut + 1) })
  }
  for (const model of input.models) if (model.older !== true && model.own !== true) add({ runtime: model.runtime, model: model.id })
  const first = candidates[0]
  if (first === undefined) return []
  /*
   * FREE STAYS FREE (0.515). A pass on 0.512 opened Compare on a free
   * teammate and found model B on GPT-6.1 Sol -- another runtime, which is
   * the usual preference, and a paid one nobody chose. When the first is one
   * of OpenCode's free models, the second is another free one if there is.
   */
  const free = (one: Choice): boolean => one.runtime === 'opencode' && one.model.endsWith('-free')
  // And one that has answered here before one that has not: the first listed can be down for a day (0.517).
  const otherFree = candidates.filter((one) => one !== first && free(one))
  const second = (free(first) ? otherFree.find((one) => input.answered?.includes(one.model) === true) ?? otherFree[0] : undefined)
    ?? candidates.find((one) => one.runtime !== first.runtime)
    ?? candidates[1]
  if (second === undefined) return []
  // The box's effort comes with its model (0.545, Sol: Flash Low opened Compare on Medium).
  return [first, second].map((choice) => ({ runtime: choice.runtime, model: choice.model, ...(choice.effort === undefined ? {} : { effort: choice.effort }), label: input.label(choice) }))
}
