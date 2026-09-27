import { useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { PublicTeammate } from '../../../shared/ipc.js'
import { roleLabelOf } from '../../../shared/ipc.js'
import { routeModelName } from '../routeName.js'
import { RuntimeMark } from './RuntimeMark.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * THE TEAM AS A PICTURE OF ITSELF (0.398; shared/team-card.ts).
 *
 * The card is drawn here, photographed by the host from this window, and
 * saved with the team written into the image as data -- so the picture is
 * both what you show someone and what they drop into Locust to have the same
 * teammates. Every face, name, role and model on it is what the data holds;
 * nothing is drawn that does not come across.
 */
export function TeamCardView({ teammates }: { readonly teammates: readonly PublicTeammate[] }): ReactElement {
  return (
    <div className="lc-teamcard">
      <div className="lc-teamcard__head">
        <span className="lc-teamcard__brand">LOCUST</span>
        <span className="lc-teamcard__count lc-mono">
          {teammates.length} {teammates.length === 1 ? 'teammate' : 'teammates'}
        </span>
      </div>
      <div className="lc-teamcard__grid">
        {teammates.map((teammate) => (
          <div className="lc-teamcard__member" key={teammate.teammateId}>
            <TeammateBot hue={teammate.hue} avatar={teammate.avatar} size={44} teammateId={teammate.teammateId} motion="subtle" />
            <span className="lc-teamcard__text">
              <span className="lc-teamcard__name">{teammate.name}</span>
              <span className="lc-teamcard__role">{roleLabelOf(teammate)}</span>
              {teammate.route !== undefined && !/^own-/i.test(teammate.route.model) && (
                <span className="lc-teamcard__model">
                  <RuntimeMark runtime={teammate.route.runtime} size={11} />
                  {routeModelName(teammate.route.runtime, teammate.route.model)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <span className="lc-teamcard__foot">To add this team, open this image in Locust with Add team from image.</span>
    </div>
  )
}

export function ShareTeamDialog({ teammates, onClose }: { readonly teammates: readonly PublicTeammate[]; readonly onClose: () => void }): ReactElement {
  const card = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string>()
  const save = async (): Promise<void> => {
    const bridge = window.desktop
    const box = card.current?.getBoundingClientRect()
    if (bridge === undefined || box === undefined) return
    setBusy(true)
    setSaid(undefined)
    try {
      const saved = await bridge.saveTeamCard({ x: box.left, y: box.top, width: box.width, height: box.height })
      if (!saved.ok) setSaid(saved.message)
      else if (saved.path !== undefined) setSaid(`Saved to ${saved.path}. Anyone with Locust can add this team from it.`)
    } catch {
      setSaid('The team card could not be saved. Nothing was written.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="lc-scrim">
      <div className="lc-dialog lc-shareteam" role="dialog" aria-modal="true" aria-label="Share your team">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">Share your team</span>
        </div>
        <div className="lc-dialog__body lc-shareteam__body">
          <div ref={card} className="lc-shareteam__frame">
            <TeamCardView teammates={teammates} />
          </div>
          <p className="lc-shareteam__claim">
            The image carries each teammate&rsquo;s name, role, look and model, so it can be dropped into Locust as a team.
            Nothing else goes with it: no conversations, memories, folders, limits or keys, and not a model of your own.
          </p>
          {said !== undefined && <p className="lc-shareteam__claim lc-shareteam__said" role="status">{said}</p>}
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="lc-primarybutton" disabled={busy} onClick={() => void save()}>
            Save image
          </button>
        </div>
      </div>
    </div>
  )
}
