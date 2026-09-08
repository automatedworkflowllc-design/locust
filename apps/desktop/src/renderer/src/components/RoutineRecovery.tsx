import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PublicRoutine } from '../../../shared/ipc.js'
import type { RoutineRecoveryRequest, RoutineRecoveryResponse } from '../../../shared/routine-recovery.js'

export type RecoverRoutine = (request: RoutineRecoveryRequest) => Promise<RoutineRecoveryResponse>

/** This is durable card content, not a dismissible toast: missing one event
 * must not hide a routine that has been waiting for four days. */
export function RoutineRecovery({ routine, recover, onOpenMission }: {
  readonly routine: PublicRoutine
  readonly recover?: RecoverRoutine
  readonly onOpenMission?: (missionId: string) => void
}): ReactElement | null {
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string>()
  const execution = routine.execution
  if (execution === undefined || execution.status === 'running') return null
  const decide = async (decision: RoutineRecoveryRequest['decision']): Promise<void> => {
    if (recover === undefined || busy || !reviewed) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await recover({ routineId: routine.routineId, attemptId: execution.attemptId, step: execution.step, decision })
      if (!response.ok) setError(response.error.message)
    } catch {
      setError('Could not record your decision. Reload routines and check the saved attempt before trying again.')
    } finally {
      setBusy(false)
      setReviewed(false)
    }
  }
  /*
   * `lc-recovery` rather than an inline style.
   *
   * This carried `style={{ display: 'block', whiteSpace: 'normal' }}` because
   * it used to live INSIDE `lc-routinerow__name`, a one-line ellipsised span
   * that would otherwise have collapsed it. It is a row of its own now, so the
   * override is no longer holding anything up and the class can say what this
   * is instead.
   *
   * Amber is right and stays: this holds controls and is waiting on a person,
   * which is the pending register.
   */
  return <div className="lc-recovery lc-routinerow__meta lc-tone-amber">
    <strong>{execution.status === 'abandoned' ? 'Attempt abandoned' : 'Waiting for your review'}</strong>
    {' · '}Step {execution.step} of {execution.of}{' · '}Attempt started {new Date(execution.startedAt).toLocaleString()}
    <span style={{ display: 'block' }}>{execution.reason ?? 'Dispatch outcome is uncertain. Nothing will be replayed automatically.'}</span>
    {execution.missionId !== undefined && <span style={{ display: 'block' }}>Saved mission: {execution.missionId}</span>}
    {execution.missionId !== undefined && onOpenMission !== undefined && <button type="button" className="lc-ghostbutton"
      onClick={() => onOpenMission(execution.missionId!)}>Open saved mission</button>}
    {execution.status !== 'abandoned' && <>
      <details><summary>Review saved steps and route</summary>
        <span>{execution.route.runtime} · {execution.route.model} · {execution.route.mode}</span>
        <ol>{execution.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      </details>
      <span style={{ display: 'block' }}>Abandon removes the schedule; it does not stop a runtime or undo work. A later Run starts again from step 1.</span>
      <label style={{ display: 'block' }}><input type="checkbox" checked={reviewed} disabled={busy}
        onChange={(event) => setReviewed(event.target.checked)} /> I reviewed the saved mission and external work, and whether the remaining work is still wanted.</label>
      <button type="button" className="lc-ghostbutton" disabled={busy || !reviewed || !execution.canContinue || recover === undefined}
        onClick={() => { void decide('continue') }}>Continue remaining steps</button>
      <button type="button" className="lc-ghostbutton" disabled={busy || !reviewed || recover === undefined}
        onClick={() => { void decide('abandon') }}>Abandon attempt and remove schedule</button>
    </>}
    {error !== undefined && <span role="alert">{error}</span>}
  </div>
}
