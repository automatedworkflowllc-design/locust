import { useState } from 'react'
import type { ReactElement } from 'react'

/**
 * SAVE THE RECORD (0.574): one conversation as one Markdown file.
 *
 * The one place the person is told what the file is. The words are said once,
 * here, and not again in the file or on the way out: it holds the whole
 * conversation, and what happens to it after it is saved is theirs to decide.
 * The destination is a native save dialog the host opens; nothing uploads and
 * nothing opens.
 */
export const RECORD_CLAIM = 'This file contains the conversation. Read it before you send it.'

export function SaveRecordDialog({ missionId, onClose }: { readonly missionId: string; readonly onClose: () => void }): ReactElement {
  const [includeRaw, setIncludeRaw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string>()
  const save = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) {
      setSaid('Saving is not available here. Nothing was written.')
      return
    }
    setBusy(true)
    setSaid(undefined)
    bridge
      .saveMissionRecord({ missionId, includeRaw })
      .then((saved) => {
        if (!saved.ok) setSaid(saved.message)
        // Cancelled in the save dialog: the person is still here, and nothing was written.
        else if (saved.path === undefined) setSaid(undefined)
        else setSaid(saved.rawPath === undefined ? `Saved to ${saved.path}.` : `Saved to ${saved.path}, and the raw record beside it at ${saved.rawPath}.`)
      })
      .catch(() => setSaid('The record could not be saved. Nothing was written.'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="lc-scrim">
      <div className="lc-dialog lc-saverecord" role="dialog" aria-modal="true" aria-label="Save the record">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">Save the record</span>
        </div>
        <div className="lc-dialog__body lc-saverecord__body">
          <p className="lc-saverecord__claim">{RECORD_CLAIM}</p>
          <label className="lc-saverecord__with">
            <input type="checkbox" checked={includeRaw} onChange={(event) => setIncludeRaw(event.target.checked)} />
            <span>Include the raw record (JSON)</span>
          </label>
          {said !== undefined && (
            <p className="lc-saverecord__claim lc-saverecord__said" role="status">
              {said}
            </p>
          )}
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="lc-primarybutton" disabled={busy} onClick={save}>
            Save the record…
          </button>
        </div>
      </div>
    </div>
  )
}
