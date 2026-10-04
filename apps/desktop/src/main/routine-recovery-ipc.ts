import { isRoutineRecoveryRequest } from '../shared/routine-recovery.js'
import type { RoutineRecoveryResponse } from '../shared/routine-recovery.js'
import type { RoutineRunner } from './routine-runner.js'

/** Keep validation in main: disabling a renderer button is not authorization. */
export async function decideRoutineRecovery(input: unknown, ownWindow: boolean, workspaceChosen: boolean,
  runner: RoutineRunner | undefined): Promise<RoutineRecoveryResponse> {
  if (!ownWindow || !isRoutineRecoveryRequest(input)) return { ok: false, error: { message: 'Invalid routine recovery request.' } }
  if (!workspaceChosen || runner === undefined) return { ok: false, error: { message: 'Open the original project folder before reviewing this routine.' } }
  try {
    return await runner.recover(input)
  } catch {
    return { ok: false, error: { message: 'Recovery could not be recorded or started. Check disk access and the saved mission, then reload routines. No automatic replay will occur.' } }
  }
}
