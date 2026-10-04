import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { CSSProperties, ReactElement } from 'react'

import type { AvatarSpec } from '../../../shared/avatar.js'
import type { TeammateHue } from '../../../shared/ipc.js'
import type { TeamCardState } from '../homeTeamState.js'
import { Icon } from './Icon.js'
import { RuntimeMark } from './RuntimeMark.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * YOUR TEAM, FIRST.
 *
 * Home led with a table of coding-tool versions -- "Codex CLI . Ready .
 * 0.157.0" -- under the words "Your coding agents", and the teammates a person
 * had made appeared nowhere on it (first-impressions drive, packaged 0.349).
 * Locust is for "quite literally ANY ai user" and its edge is teammates that
 * work together on the model you choose (Colin, 2026-09-26); the first
 * screen should say so by showing them. Each card is the teammate: face,
 * name, what they do, the model they run on -- and pressing it is talking to
 * them. What is connected is still on the screen, folded to one line once
 * nothing about it needs the person (FirstLaunch).
 */
export interface HomeTeammate {
  readonly teammateId: string
  readonly name: string
  readonly hue: TeammateHue
  readonly avatar: AvatarSpec
  readonly role: string
  /** The route in words, "Codex . Account default"; absent before a first run. */
  readonly route?: string
  /** The model alone, "Opus 5.5": what the line shows beside the runtime's mark (0.384). */
  readonly model?: string
  /** Whose mark stands for the runtime (0.383); absent on a model of the person's own. */
  readonly runtime?: MissionRuntimeId
  /** Running right now. */
  readonly working: boolean
  /** Where the teammate stands (0.606): the live word, "waiting on you", or what blocks them. Absent when idle. */
  readonly state?: TeamCardState
  /** What an idle teammate last did, for the card's hover (0.609): "last worked 3 hours ago", "no work yet". */
  readonly lastWorked?: string
  /** What they are doing now (0.610): the step under way, or what they wait on you for. Shown in the role's place while they do it. */
  readonly doing?: string
}

export function HomeTeam({
  team,
  onMessage,
  onNewTeammate
}: {
  readonly team: readonly HomeTeammate[]
  readonly onMessage: (teammateId: string) => void
  readonly onNewTeammate?: () => void
}): ReactElement {
  return (
    <section className="lc-hometeam" aria-label="Your team">
      {/*
        * "New teammate" in the section's head, the way Claude's "New project"
        * sits -- a card for it wrapped onto a row of its own under three
        * teammates, and read as a fourth, empty teammate.
        */}
      <div className="lc-hometeam__top">
        {/* How many, beside the words (0.610): the grid shows two rows of a team that may be larger. */}
        <h2 className="lc-hometeam__head">
          Your team<span className="lc-hometeam__count">{String(team.length)}</span>
        </h2>
        {onNewTeammate !== undefined && (
          <button type="button" className="lc-control lc-control--boxed lc-chipbutton" onClick={onNewTeammate}>
            <Icon name="plus" size={13} />
            New teammate
          </button>
        )}
      </div>
      <div className="lc-hometeam__grid">
        {team.map((mate) => {
          // While they work or wait, the line under the name says what on (0.610); otherwise it is the role.
          const doing = mate.state !== undefined && mate.state.tone !== 'red' ? mate.doing : undefined
          return (
          <button
            type="button"
            key={mate.teammateId}
            className={`lc-hometeam__card${mate.state?.tone === 'live' ? ' is-live' : mate.state?.tone === 'amber' ? ' is-waiting' : ''}`}
            onClick={() => onMessage(mate.teammateId)}
            aria-label={`Message ${mate.name}, ${mate.role}${mate.state !== undefined ? `, ${mate.state.spoken}` : mate.working ? ', working now' : ''}${mate.route === undefined ? '' : `, on ${mate.route}`}`}
            {...(mate.state === undefined && mate.lastWorked !== undefined ? { title: mate.lastWorked } : {})}
          >
            {/*
              * THE FACE ON A TILE OF ITS TEAMMATE'S COLOUR (0.610). Six grey cards
              * told teammates apart by a 34px face alone (Colin's mockup,
              * 2026-10-04). The tile is the teammate's hue, faint, the way the
              * sidebar and the conversations already wear it.
              */}
            <span className="lc-hometeam__tile" style={{ '--lc-tile': `var(--lc-hue-${mate.hue})` } as CSSProperties} aria-hidden="true">
              <TeammateBot hue={mate.hue} avatar={mate.avatar} size={34} teammateId={mate.teammateId} activity={mate.working ? 'working' : 'idle'} />
            </span>
            <span className="lc-hometeam__text">
              <span className="lc-hometeam__name">
                {mate.name}
                {/*
                  * THE STATE, BESIDE THE NAME (0.606). The card said "working" or
                  * nothing, so a teammate waiting on an answer, one blocked on a
                  * sign-in and one idle since Tuesday all read the same. The same
                  * fact the sidebar face draws, worded for here (homeTeamState.ts).
                  */}
                {mate.state !== undefined
                  ? <span className={`lc-hometeam__state is-${mate.state.tone}`}>{mate.state.word}</span>
                  : mate.working && <span className="lc-hometeam__state is-live">working</span>}
              </span>
              <span className={`lc-hometeam__role${doing === undefined ? '' : ' is-doing'}`} {...(doing === undefined ? {} : { title: doing })}>{doing ?? mate.role}</span>
              {/*
                * THE MARK SAYS THE RUNTIME; THE WORDS SAY THE MODEL (0.384).
                *
                * "Cursor · Grok 4.7 Medium" did not fit a card and was cut to
                * "Mediu..." on Colin's own Home (2026-09-26), and the runtime's
                * word said again what its mark, one glyph to the left, already
                * said. The whole route is the line's hover and the card's
                * accessible name. A model of the person's own has no mark and
                * keeps its name, which is the whole of its route anyway.
                */}
              <span className="lc-hometeam__route" {...(mate.route === undefined ? {} : { title: mate.route })}>
                {mate.route === undefined ? (
                  'runs on the model you pick'
                ) : mate.runtime !== undefined && mate.model !== undefined ? (
                  <>
                    <RuntimeMark runtime={mate.runtime} size={11} className="is-inline" />
                    {mate.model}
                  </>
                ) : (
                  mate.route
                )}
              </span>
            </span>
            <span className="lc-hometeam__go" aria-hidden="true">
              <Icon name="chevron-right" size={13} />
            </span>
          </button>
          )
        })}
      </div>
    </section>
  )
}
