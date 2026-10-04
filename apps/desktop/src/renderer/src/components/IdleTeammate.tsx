import type { ReactElement } from 'react'

import type { MissionMode, PublicTeammate, TeammateRole } from '../../../shared/ipc.js'
import { ROLE_DESCRIPTIONS, roleLabelOf } from '../../../shared/ipc.js'
import { modeSentence } from '../status.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * What the current mode lets this teammate do, said for THAT mode. The
 * sentence used to be fixed -- "Nothing is changed unless you pick a mode
 * that allows it" -- above a composer whose default is Accept edits, so a
 * fresh Research teammate promised read-only while the footer said it may
 * edit the workspace (user session 1, 2026-09-05).
 */
/*
 * Moved to `status.ts` beside every other phrasing of a mode. Re-exported
 * because this is where callers already look for it.
 */
export { modeSentence }

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
 *
 * A teammate made from a team template brings its own (0.359), in its team's
 * world; these are for a teammate made by hand. Only the roles that ARE code
 * speak of code: a Research or Data teammate may be looking at a folder of
 * statements or drafts, and "this codebase" told a person who picked
 * Research & money that Locust was not for them.
 */
const STARTERS: Readonly<Record<TeammateRole, readonly string[]>> = {
  'Code & Migrations': [
    'Read this project and tell me what it does, in one paragraph.',
    'Find the riskiest file in this repo and explain why.',
    'What would break first if traffic doubled?'
  ],
  'Research & Briefs': [
    'Summarize what is in this folder, for someone seeing it for the first time.',
    'List the decisions already made here that would be expensive to reverse.',
    'What would you want to know before you started on anything here?'
  ],
  'Ops & Scheduling': [
    'What work here repeats, and which of it could run on a schedule?',
    'Which failures here would nobody notice for a week?',
    'Make me a checklist for the routine work this folder seems to need.'
  ],
  'Docs & QA': [
    'Find anything written here that no longer matches what it describes.',
    'What here is unchecked that would hurt most if it were wrong?',
    'Read the main document here and tell me what a new reader would still get wrong.'
  ],
  'Data & Reporting': [
    'Find the numbers in this folder and say where each one comes from.',
    'What would a weekly summary of the work here contain?',
    'Which figure here would you check first, and why?'
  ],
  'Chief of Staff': [
    'Look at the team and tell me who should take what.',
    'Ask each teammate for one thing they would do first, and bring me the list.',
    'What is the state of the work here? Delegate the reading and report back.'
  ],
  Custom: [
    'What can you help me with? Give me three concrete examples.',
    'Ask me three questions about what I need, then suggest where to start.',
    'Look at the files in this folder and tell me what you could do with them.'
  ]
}

export function IdleTeammate({
  teammate,
  canStart,
  blocked,
  onStarter,
  mode
}: {
  readonly teammate: PublicTeammate
  readonly canStart: boolean
  /**
   * Why this teammate cannot start at all, when it cannot -- the runtime is
   * installed and signed out. Absent when it can.
   *
   * Separate from `canStart`, which only means a mission is already running.
   * Conflating them is what let this screen offer starter buttons to a
   * teammate whose runtime was signed out (Astra's Finding 1, 2026-09-14).
   */
  readonly blocked?: string
  readonly onStarter: (prompt: string) => void
  /** The composer's current permission mode: the sentence below must say what THIS mode does. */
  readonly mode: MissionMode
}): ReactElement {
  const starters = teammate.starters ?? STARTERS[teammate.role] ?? STARTERS.Custom
  // A Custom teammate's title is what they do; a built-in role says it in a few words.
  const about = teammate.role === 'Custom' ? undefined : ROLE_DESCRIPTIONS[teammate.role]

  return (
    <div className="lc-empty">
      <div className="lc-empty__inner">
        <TeammateBot hue={teammate.hue} avatar={teammate.avatar} size={56} />
        <h1>{teammate.name}</h1>
        <p>
          {roleLabelOf(teammate)}
          {about === undefined ? '' : ` · ${about}`}. {modeSentence(mode)}
        </p>

        <div className="lc-starters">
          {starters.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="lc-starter"
              disabled={!canStart || blocked !== undefined}
              onClick={() => onStarter(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <p className={`lc-footnote${blocked === undefined ? '' : ' lc-tone-red'}`}>
          {blocked !== undefined
            ? blocked
            : canStart
              ? 'Pick one, or say what you need below.'
              : 'Connect a runtime to start a mission.'}
        </p>
      </div>
    </div>
  )
}
