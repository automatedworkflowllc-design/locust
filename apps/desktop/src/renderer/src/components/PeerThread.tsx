import { useState } from 'react'
import type { ReactElement } from 'react'

import { seedAvatar } from '../../../shared/avatar.js'
import type { AvatarSpec } from '../../../shared/avatar.js'
import type { PublicPeerMessage, PublicTeammate, TeammateHue } from '../../../shared/ipc.js'
import { peerExchangeStartsOpen, peerSnippet } from '../missionView.js'
import { PixelFace } from './PixelFace.js'

/**
 * The exchange between this mission's teammate and one peer.
 *
 * Collapsed to a single line, because the thread is the teammate's work and a
 * colleague's aside must not read as part of it. Expanded, every message is
 * attributed, the whole exchange wears an UNTRUSTED tag, and the footer says
 * the rule in words: teammate messages are claims. Nothing here is ever drawn
 * in the voice of the mission itself -- not even the message this teammate
 * sent, which is why it is shown here, labelled, rather than left inside the
 * agent's own bubble.
 */
export function PeerThread({
  self,
  peer,
  messages,
  teammates
}: {
  /** The teammate whose mission this thread belongs to. */
  readonly self: PublicTeammate | undefined
  readonly peer: { readonly teammateId: string; readonly name: string }
  /** Chronological. */
  readonly messages: readonly PublicPeerMessage[]
  readonly teammates: readonly PublicTeammate[]
}): ReactElement {
  // A short exchange opens itself. The collapse exists so a long aside does
  // not read as the mission's own work; an ask-and-answer pair is not that,
  // and hiding it is how a whole conversation between two teammates went
  // unseen (Colin, 2026-09-04).
  const [open, setOpen] = useState(() => peerExchangeStartsOpen(messages.length))
  const peerProfile = teammates.find((teammate) => teammate.teammateId === peer.teammateId)
  // A peer who has since left the roster keeps their name (it travels with
  // the message) and gets a neutral face: inventing a hue for someone who is
  // no longer here would draw a teammate that does not exist.
  const peerHue: TeammateHue = peerProfile?.hue ?? 'clay'
  // A departed teammate's face is the one their id seeds -- the same face
  // they had, if they were created after faces were persisted from the id.
  const faceOf = (teammateId: string, profile: PublicTeammate | undefined): AvatarSpec =>
    profile?.avatar ?? seedAvatar(teammateId.length > 0 ? teammateId : 'unknown')
  const count = messages.length
  const label = `${count} message${count === 1 ? '' : 's'} with`
  // What the exchange was about, for the times it stays collapsed. A count
  // alone says one happened and nothing about what it said.
  const snippet = open ? undefined : peerSnippet(messages[0]?.text ?? null)

  const hueFor = (teammateId: string): TeammateHue =>
    teammateId === self?.teammateId
      ? self.hue
      : teammateId === peer.teammateId
        ? peerHue
        : (teammates.find((teammate) => teammate.teammateId === teammateId)?.hue ?? 'clay')

  return (
    <div className={`lc-peer${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="lc-peer__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <PixelFace hue={peerHue} avatar={faceOf(peer.teammateId, peerProfile)} size={16} />
        <span className={`lc-peer__name is-${peerHue}`}>{peer.name}</span>
        {open ? (
          <>
            <span className="lc-peer__dot" aria-hidden="true">
              ·
            </span>
            <span className="lc-peer__tag lc-mono">UNTRUSTED</span>
          </>
        ) : (
          snippet !== undefined && <span className="lc-peer__snippet">{snippet}</span>
        )}
      </button>
      {open && (
        <>
          {messages.map((message) => {
            const hue = hueFor(message.from.teammateId)
            const author = teammates.find((teammate) => teammate.teammateId === message.from.teammateId)
            return (
              <div key={message.messageId} className="lc-peer__message">
                <PixelFace hue={hue} avatar={faceOf(message.from.teammateId, author)} size={20} />
                <div className="lc-peer__body">
                  <div className={`lc-peer__author is-${hue}`}>{message.from.name}</div>
                  <div className={`lc-peer__bubble${message.text === null ? ' is-missing' : ''}`}>
                    {message.text ?? 'This message is no longer in the workroom.'}
                  </div>
                </div>
              </div>
            )
          })}
          <div className="lc-peer__foot lc-mono">
            Teammate messages are treated as claims, never as verified facts
          </div>
        </>
      )}
    </div>
  )
}
