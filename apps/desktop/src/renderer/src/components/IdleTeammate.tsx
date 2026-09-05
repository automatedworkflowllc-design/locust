import type { ReactElement } from 'react'

import type { MissionMode, PublicTeammate, TeammateRole } from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import { PixelFace } from './PixelFace.js'

/**
 * What the current mode lets this teammate do, said for THAT mode. The
 * sentence used to be fixed -- "Nothing is changed unless you pick a mode
 * that allows it" -- above a composer whose default is Accept edits, so a
 * fresh Research teammate promised read-only while the footer said it may
 * edit the workspace (user session 1, 2026-09-05).
 */
export function modeSentence(mode: MissionMode): string {
  switch (mode) {
    case 'ask':
      return 'In Ask mode nothing is changed: every write is refused.'
    case 'approve-each':
      return 'Every change waits for your approval before it lands.'
    case 'accept-edits':
      return 'Accept edits is on, so it may change files here; switch to Ask below to keep it read-only.'
  }
}

/**
 * The idle teammate: a capability-led empty state.
 *
 * The design's rule for this surface is to lead with what the teammate is good
 * at rather than with an empty box. The starters below come from the ROLE the
 * user chose, so they describe work this teammate was actually set up for --
 * and each is a prompt that can be sent as-is, not a category heading.
 *
 * They are suggestions, not capabilities: everything here is read-only phrasing
 * that any runtime can attempt, so a starter cannot promise something the
 * sandbox would refuse.
 */
const STARTERS: Readonly<Record<TeammateRole, readonly string[]>> = {
  'Code & Migrations': [
    'Read this project and tell me what it does, in one paragraph.',
    'Find the riskiest file in this repo and explain why.',
    'What would break first if traffic doubled?'
  ],
  'Research & Briefs': [
    'Summarize what this codebase is for, for someone joining tomorrow.',
    'List the decisions this project has already made that would be expensive to reverse.',
    'What questions would you ask the author before changing anything?'
  ],
  'Ops & Scheduling': [
    'What routine work does this project seem to need that nobody has automated?',
    'Read the scripts here and tell me what runs on a schedule.',
    'Which failures here would nobody notice for a week?'
  ],
  'Docs & QA': [
    'Find documentation in this repo that no longer matches the code.',
    'What is untested that would hurt most if it broke?',
    'Read the README and tell me what a new person would still get wrong.'
  ],
  'Data & Reporting': [
    'What data does this project produce, and where does it go?',
    'Find every number this codebase reports and say where it comes from.',
    'What would a weekly summary of this project contain?'
  ],
  Custom: [
    'Read this project and tell me what it does.',
    'What is the most surprising thing in this codebase?',
    'What should I look at first?'
  ]
}

export function IdleTeammate({
  teammate,
  canStart,
  onStarter,
  mode
}: {
  readonly teammate: PublicTeammate
  readonly canStart: boolean
  readonly onStarter: (prompt: string) => void
  /** The composer's current permission mode: the sentence below must say what THIS mode does. */
  readonly mode: MissionMode
}): ReactElement {
  const starters = STARTERS[teammate.role] ?? STARTERS.Custom

  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        <PixelFace hue={teammate.hue} avatar={teammate.avatar} size={56} />
        <h1>{teammate.name}</h1>
        <p>
          {roleLabelOf(teammate)} · reads this workspace and explains what it finds. {modeSentence(mode)}
        </p>

        <div className="lc-starters">
          {starters.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="lc-starter"
              disabled={!canStart}
              onClick={() => onStarter(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <p className="lc-footnote">
          {canStart
            ? 'Pick one, or describe a mission below.'
            : 'Connect a runtime to start a mission.'}
        </p>
      </div>
    </div>
  )
}
