import type { ReactElement } from 'react'

import { runtimeDisplayName } from '../../../shared/runtimes.js'
import type { TerminalSeam } from '../missionView.js'
import { Icon } from './Icon.js'

/**
 * Where a conversation went into a runtime's own terminal, and where it came
 * back (0.391).
 *
 * Colin, 2026-09-27: "wont we want to be able to keep up on projects our
 * users carry on w/ terminal?" The turns below this line were typed there and
 * brought back from the runtime's own record of the session, so they are the
 * person's words and the runtime's answers -- but Locust did not run them,
 * and the runtime ran them with its own permissions. The same rule-with-a-
 * label as a handoff: a boundary, not another thing an agent produced.
 */
export function TerminalDivider({ seam }: { readonly seam: TerminalSeam }): ReactElement {
  if ('back' in seam) {
    return (
      <div className="lc-handoff" role="separator" aria-label="Back in Locust">
        <span className="lc-handoff__rule lc-handoff__rule--start" />
        <div className="lc-handoff__body">
          <span className="lc-handoff__title">Back in Locust</span>
        </div>
        <span className="lc-handoff__rule lc-handoff__rule--end" />
      </div>
    )
  }
  const name = runtimeDisplayName(seam.into)
  return (
    <div className="lc-handoff" role="separator" aria-label={`In ${name}'s terminal`}>
      <span className="lc-handoff__rule lc-handoff__rule--start" />
      <div className="lc-handoff__body">
        <span className="lc-handoff__title">
          <Icon name="code" size={12} />
          <span>
            {'In '}
            <span className="lc-handoff__to">{name}</span>
            {"'s terminal"}
          </span>
        </span>
        <span className="lc-handoff__note">{`Typed there and brought back. ${name} ran it with its own permissions, not this conversation's mode.`}</span>
      </div>
      <span className="lc-handoff__rule lc-handoff__rule--end" />
    </div>
  )
}
