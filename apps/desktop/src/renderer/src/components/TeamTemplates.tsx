import { useState } from 'react'
import type { ReactElement } from 'react'

import { seedAvatar } from '../../../shared/avatar.js'
import type { AvatarSpec } from '../../../shared/avatar.js'
import { TEAM_TEMPLATES } from '../../../shared/team-templates.js'
import type { TeamTemplate } from '../../../shared/team-templates.js'
import { Icon } from './Icon.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * START WITH A TEAM (0.354).
 *
 * Home with nobody on it offered one button, "New teammate", and a sentence
 * -- a person had to invent a name, a role and a face before Locust did
 * anything. Now the same section the team will fill offers three teams, one
 * for each kind of person Locust is for (shared/team-templates.ts), laid out
 * exactly as the team row they become: the head with "New teammate" in the
 * chat bar's own chip, and a card per team. Pressing one makes its three
 * teammates, and the row turns into them.
 */
export function TeamTemplates({
  onUse,
  onNewTeammate
}: {
  /** Makes the team; resolves with why it could not, or undefined once it has. */
  readonly onUse: (templateId: TeamTemplate['templateId']) => Promise<string | undefined>
  readonly onNewTeammate: () => void
}): ReactElement {
  const [making, setMaking] = useState<TeamTemplate['templateId']>()
  const [problem, setProblem] = useState<string>()
  return (
    <section className="lc-hometeam lc-teamtemplates" aria-label="Start with a team">
      <div className="lc-hometeam__top">
        <h2 className="lc-hometeam__head">Start with a team</h2>
        <button type="button" className="lc-control lc-control--boxed lc-chipbutton" onClick={onNewTeammate}>
          <Icon name="plus" size={13} />
          New teammate
        </button>
      </div>
      <div className="lc-hometeam__grid">
        {TEAM_TEMPLATES.map((template) => (
          <button
            type="button"
            key={template.templateId}
            className="lc-hometeam__card lc-teamtemplate"
            disabled={making !== undefined}
            aria-busy={making === template.templateId}
            aria-label={`Start with the ${template.title} team: ${template.teammates.map((mate) => mate.name).join(', ')}`}
            onClick={() => {
              setMaking(template.templateId)
              setProblem(undefined)
              void onUse(template.templateId).then((why) => {
                // Made: this section is replaced by the team, so nothing to reset.
                if (why !== undefined) {
                  setProblem(why)
                  setMaking(undefined)
                }
              })
            }}
          >
            <span className="lc-teamtemplate__faces" aria-hidden="true">
              {template.teammates.map((mate) => (
                <TeammateBot
                  key={mate.name}
                  hue={mate.hue}
                  avatar={templateAvatar(template.templateId, mate)}
                  size={30}
                  activity={making === template.templateId ? 'working' : 'idle'}
                />
              ))}
            </span>
            <span className="lc-hometeam__text">
              <span className="lc-hometeam__name">{making === template.templateId ? 'Adding the team…' : template.title}</span>
              <span className="lc-teamtemplate__line">{template.line}</span>
              <span className="lc-hometeam__route">{template.teammates.map((mate) => mate.name).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
      {problem !== undefined && (
        <p className="lc-teamtemplates__problem lc-tone-amber" role="alert">
          {problem}
        </p>
      )}
      <p className="lc-teamtemplates__note">
        Each is an ordinary teammate: rename them, change their face or model, or remove them. They run on the model you pick.
      </p>
    </section>
  )
}

/**
 * The face a template teammate is made with: its chosen bot on a seeded face,
 * the same on the card that offers it and on the teammate it makes.
 */
export function templateAvatar(templateId: TeamTemplate['templateId'], mate: TeamTemplate['teammates'][number]): AvatarSpec {
  return { ...seedAvatar(`template_${templateId}_${mate.name}`), bot: mate.bot }
}
