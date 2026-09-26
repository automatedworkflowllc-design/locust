import type { ReactElement } from 'react'

import type { AvatarSpec } from '../../../shared/avatar.js'
import type { TeammateHue } from '../../../shared/ipc.js'
import { Icon } from './Icon.js'
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
          <button type="button" className="lc-hometeam__new" onClick={onNewTeammate}>
            <Icon name="plus" size={12} /> New teammate
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
            aria-label={`Message ${mate.name}, ${mate.role}${mate.working ? ', working now' : ''}`}
          >
            <TeammateBot hue={mate.hue} avatar={mate.avatar} size={34} teammateId={mate.teammateId} activity={mate.working ? 'working' : 'idle'} />
            <span className="lc-hometeam__text">
              <span className="lc-hometeam__name">
                {mate.name}
                {mate.working && <span className="lc-hometeam__working">working</span>}
              </span>
              <span className="lc-hometeam__role">{mate.role}</span>
              <span className="lc-hometeam__route">{mate.route ?? 'runs on the model you pick'}</span>
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
