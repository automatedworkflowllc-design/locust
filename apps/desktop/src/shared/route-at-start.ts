import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { TeammateRoute } from './ipc.js'
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
