import { useId } from 'react'
import type { ReactElement } from 'react'
import { isCloudEnvironmentId } from '../../../shared/claude-cloud.js'

/** W6: optional, user-supplied id. Claude Code documents no environment list command. */
export function CloudEnvironmentField({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }): ReactElement {
  const id = useId()
  const valid = value.length === 0 || isCloudEnvironmentId(value)
  return <div className="lc-cloud-environment">
    <label htmlFor={id}>Run on your organization's environment (ID)</label>
    <input id={id} className="lc-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Optional · ccpool_…" maxLength={87} pattern="ccpool_[A-Za-z0-9_-]{1,80}" aria-invalid={!valid} aria-describedby={`${id}-help`} />
    <p id={`${id}-help`} className="lc-cloudtasks__note">{valid ? 'Optional. Use an environment ID supplied by your organization. Saved for this folder when you send a task.' : 'Use ccpool_ followed by 1 to 80 letters, digits, underscores or hyphens, or leave this empty.'}</p>
  </div>
}
