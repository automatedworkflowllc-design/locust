import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { ReactElement } from 'react'

import type { AvatarSpec } from '../../../shared/avatar.js'
import type { TeammateHue } from '../../../shared/ipc.js'
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
        <h2 className="lc-hometeam__head">Your team</h2>
        {onNewTeammate !== undefined && (
          <button type="button" className="lc-control lc-control--boxed lc-chipbutton" onClick={onNewTeammate}>
            <Icon name="plus" size={13} />
            New teammate
          </button>
        )}
      </div>
      <div className="lc-hometeam__grid">
        {team.map((mate) => (
          <button
            type="button"
            key={mate.teammateId}
            className="lc-hometeam__card"
            onClick={() => onMessage(mate.teammateId)}
            aria-label={`Message ${mate.name}, ${mate.role}${mate.working ? ', working now' : ''}${mate.route === undefined ? '' : `, on ${mate.route}`}`}
          >
            <TeammateBot hue={mate.hue} avatar={mate.avatar} size={34} teammateId={mate.teammateId} activity={mate.working ? 'working' : 'idle'} />
            <span className="lc-hometeam__text">
              <span className="lc-hometeam__name">
                {mate.name}
                {mate.working && <span className="lc-hometeam__working">working</span>}
              </span>
              <span className="lc-hometeam__role">{mate.role}</span>
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
        ))}
      </div>
    </section>
  )
}
