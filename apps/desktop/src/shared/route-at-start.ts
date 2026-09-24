import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { MissionMode, TeammateRoute } from './ipc.js'
import { isMissionRuntime } from './runtimes.js'

export interface StartRouteInput {
  readonly runtime?: unknown
  readonly model?: unknown
  readonly effort?: unknown
  readonly modelChoice?: unknown
  readonly routeOverrideFor?: unknown
}

export interface StartRoute {
  readonly runtime: MissionRuntimeId
  readonly model?: string
  readonly effort?: string
}

/**
 * Discovery is not a person's model choice. The early-send race measured on
 * 2026-09-10 ran a Codex teammate on OpenCode. Resolve the saved identity at
 * the host, except for a picker choice explicitly addressed to THIS teammate.
 * An unassigned mission has no saved authority and keeps the old defaults.
 * Mode is deliberately absent: a saved Accept-edits route must not widen an
 * explicit Ask request. Permission validation remains where it already is.
 */
export function routeAtStart(
  input: StartRouteInput,
  teammate: { readonly teammateId: string; readonly route?: TeammateRoute } | undefined
): StartRoute {
  const requested: StartRoute = {
    runtime: isMissionRuntime(input.runtime) ? input.runtime : 'codex',
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
    ...(typeof input.effort === 'string' ? { effort: input.effort } : {})
  }
  const saved = teammate?.route
  if (saved === undefined || input.routeOverrideFor === teammate?.teammateId) return requested
  // Cursor encodes effort in the concrete model id. Matching the original
  // picker identity lets that transformation survive without allowing a
  // discovery fallback's model (or effort) to replace the saved identity.
  if (requested.runtime === saved.runtime && (input.modelChoice ?? input.model) === saved.model) {
    return { ...requested, model: requested.model ?? saved.model }
  }
  return {
    runtime: saved.runtime,
    model: saved.model,
    ...(saved.effort === undefined ? {} : { effort: saved.effort })
  }
}

export interface PickerRoute { readonly runtime: MissionRuntimeId; readonly model: string }

/** Keep the chip and pending header on the same choice while effects settle. */
export function composerRouteFor(
  fallback: PickerRoute,
  teammate: { readonly teammateId: string; readonly route?: TeammateRoute } | undefined,
  explicit: ReadonlyMap<string, PickerRoute>
): PickerRoute {
  if (teammate === undefined) return fallback
  return explicit.get(teammate.teammateId) ?? teammate.route ?? fallback
}

/**
 * A run started FOR a teammate who is not the one on screen yet (H9).
 *
 * "Ask <reviewer> for a review" selected the reviewer and then started the
 * run from a closure made before the selection -- so it went out as the
 * AUTHOR, on the author's route and mode, in the author's conversation, and
 * the reviewer never ran it (code review H9, reproduced from the probe's own
 * capture). The tidy pass (A1.2) copied the pattern and went out as nobody's.
 *
 * So the teammate is carried whole, from their own record: their id, the
 * route the composer would show for them (a picker choice made for them
 * wins, as it does in the composer), their saved mode and effort. Nothing is
 * read from state that has not caught up with selecting them.
 */
export interface StartAs {
  readonly teammateId: string
  readonly route: PickerRoute
  readonly mode: MissionMode
  readonly effort: string | undefined
}

export function startAs(
  teammate: { readonly teammateId: string; readonly route?: TeammateRoute },
  composer: { readonly route: PickerRoute; readonly mode: MissionMode; readonly effort: string | undefined },
  explicit: ReadonlyMap<string, PickerRoute>
): StartAs {
  // Just the picker's two fields: a saved route also carries its mode and
  // effort, which are said once, below, where they belong.
  const route = composerRouteFor(composer.route, teammate, explicit)
  return {
    teammateId: teammate.teammateId,
    route: { runtime: route.runtime, model: route.model },
    mode: teammate.route?.mode ?? composer.mode,
    effort: teammate.route === undefined ? composer.effort : teammate.route.effort
  }
}
