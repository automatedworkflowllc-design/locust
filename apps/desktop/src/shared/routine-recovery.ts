import type { TeammateRoute } from './ipc.js'

/** A dispatch receipt, not a claim that the runtime did (or did not) do work. */
export interface RoutineExecution {
  readonly attemptId: string
  readonly status: 'dispatching' | 'running' | 'held' | 'abandoned'
  readonly step: number
  readonly of: number
  readonly startedAt: string
  readonly updatedAt: string
  readonly steps: readonly string[]
  readonly route: TeammateRoute
  readonly workspaceId: string
  readonly recovered?: boolean
  readonly missionId?: string
  readonly runId?: string
  readonly followUpOf?: string
  readonly reason?: string
  readonly canContinue?: boolean
}

export const ROUTINE_RECOVERY_CHANNEL = 'routine:recovery'
export interface RoutineRecoveryRequest {
  readonly routineId: string
  readonly attemptId: string
  readonly step: number
  readonly decision: 'continue' | 'abandon'
}
export type RoutineRecoveryResponse =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly message: string } }

export function isRoutineRecoveryRequest(value: unknown): value is RoutineRecoveryRequest {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.routineId === 'string' && /^[\w-]{1,100}$/.test(input.routineId)
    && typeof input.attemptId === 'string' && /^[\w-]{1,100}$/.test(input.attemptId)
    && Number.isInteger(input.step) && Number(input.step) >= 1 && Number(input.step) <= 12
    && (input.decision === 'continue' || input.decision === 'abandon')
}
