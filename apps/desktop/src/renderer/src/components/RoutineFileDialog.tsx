import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PublicTeammate, RoutineFlaggedPath, RoutineImportPreview } from '../../../shared/ipc.js'
import { useModal } from '../useModal.js'

export function RoutineImportDialog({ preview, team, onImport, onCancel }: { readonly preview: RoutineImportPreview; readonly team: readonly PublicTeammate[]; readonly onImport: (teammateId: string) => Promise<void>; readonly onCancel: () => void }): ReactElement {
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onCancel)
  return <div className="lc-scrim"><div ref={box} className="lc-dialog" role="dialog" aria-modal="true" aria-label="Import routine">
    <div className="lc-dialog__head"><span className="lc-dialog__title">Import {preview.name}</span><button className="lc-dialog__close" aria-label="Close" onClick={onCancel}>×</button></div>
    <div className="lc-dialog__body lc-routineinputs">
      <span className="lc-fieldlabel">Steps</span><ol>{preview.steps.map((step, at) => <li key={at}><p className="lc-routinepreview__step">{step}</p>{preview.handOffRoles[at] && <p className="lc-dialog__note">Source role: {preview.handOffRoles[at]}</p>}</li>)}</ol>
      <span className="lc-fieldlabel">Inputs</span>{preview.inputs.length === 0 ? <p>None</p> : <ul>{preview.inputs.map((input) => <li key={input.key}>{input.label} · {input.kind}{input.required ? ' · required' : ''}{input.default === undefined ? '' : ` · default: ${input.default}`}{input.choices === undefined ? '' : ` · choices: ${input.choices.join(', ')}`}</li>)}</ul>}
      <span className="lc-fieldlabel">Connectors it needs</span>{preview.connectors.length === 0 ? <p>None named</p> : <ul>{preview.connectors.map((entry) => <li key={entry.name}>{entry.name} · {entry.present ? 'present' : 'missing'}</li>)}</ul>}
      {preview.runtime && <p className="lc-dialog__note">Made for {preview.runtime}. It will use your selected teammate’s route.</p>}
      <label>Give it to<select className="lc-input" aria-label="Give routine to" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Choose a teammate</option>{team.map((mate) => <option key={mate.teammateId} value={mate.teammateId}>{mate.name}</option>)}</select></label>
      <p className="lc-dialog__note">Every step goes to this teammate. Import saves it read-only, with no schedule, and runs nothing.</p>
      {error && <p className="lc-dialog__error">{error}</p>}
    </div><div className="lc-dialog__foot"><button className="lc-ghostbutton" onClick={onCancel}>Cancel</button><button className="lc-primarybutton" disabled={busy || !owner} onClick={() => {
      setBusy(true); void onImport(owner).then(onCancel).catch((failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : 'Import could not be confirmed. Check Routines before importing again.') })
    }}>{busy ? 'Importing…' : 'Import routine'}</button></div>
  </div></div>
}

export function RoutineExportDialog({ flagged, onExport, onCancel }: { readonly flagged: readonly RoutineFlaggedPath[]; readonly onExport: (paths: 'input' | 'keep') => Promise<void>; readonly onCancel: () => void }): ReactElement {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onCancel)
  const save = (paths: 'input' | 'keep'): void => {
    setBusy(true); void onExport(paths).then(onCancel).catch((failure: unknown) => { setBusy(false); setError(failure instanceof Error ? failure.message : 'The routine could not be exported. Check the destination folder and try again.') })
  }
  return <div className="lc-scrim"><div ref={box} className="lc-dialog" role="dialog" aria-modal="true" aria-label="Export routine paths">
    <div className="lc-dialog__head"><span className="lc-dialog__title">Paths in this routine</span><button className="lc-dialog__close" aria-label="Close" onClick={onCancel}>×</button></div>
    <div className="lc-dialog__body"><p>These steps name paths on this machine. Make them text inputs to enter when you run the imported routine, or keep them in the file.</p><ul>{flagged.map((entry, at) => <li className="lc-routinepreview__step" key={at}>Step {entry.step}: {entry.path}</li>)}</ul>{error && <p className="lc-dialog__error">{error}</p>}</div>
    <div className="lc-dialog__foot"><button className="lc-ghostbutton" onClick={onCancel}>Cancel</button><button className="lc-ghostbutton" disabled={busy} onClick={() => save('keep')}>Keep paths</button><button className="lc-primarybutton" disabled={busy} onClick={() => save('input')}>Make paths inputs</button></div>
  </div></div>
}
