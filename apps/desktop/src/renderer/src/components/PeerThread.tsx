import { useState } from 'react'
import type { ReactElement } from 'react'

import { agoLabel } from '../teammateWork.js'
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
 * attributed. Nothing here is ever drawn in the voice of the mission itself --
 * not even the message this teammate sent, which is why it is shown here,
 * labelled, rather than left inside the agent's own bubble. That attribution
 * IS the honesty; the UNTRUSTED tag and the "treated as claims" footer that
 * used to sit here were removed on Colin's word (2026-09-06): "teammates are
 * AI, no one else adds disclaimers with their models in chat like that, why
 * clutter?"
 */
export function PeerThread({
  self,
  peer,
  messages,
  teammates,
  onOpenPeerRun
}: {
  /** The teammate whose mission this thread belongs to. */
  readonly self: PublicTeammate | undefined
  readonly peer: { readonly teammateId: string; readonly name: string }
  /** Chronological. */
  readonly messages: readonly PublicPeerMessage[]
  readonly teammates: readonly PublicTeammate[]
  /**
   * Open the run this message was delivered into, when the record shows one.
   * Colin, 2026-09-04: a teammate's relayed run should be reachable from the
   * exchange in the thread you are actually in, not found by scrolling the
   * sidebar. Absent when nothing received it -- the message may still be
   * waiting for that teammate's next run, and a dead control would say
   * otherwise.
   */
  readonly onOpenPeerRun: (messageId: string) => (() => void) | undefined
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
  // Direction, not just a count. "1 message with Booty" left the reader to
  // find out who sent it from the row underneath, which is why that row was
  // repeating the pill (Colin, 2026-09-06: "lots of clutter"). One message
  // says which way it went; a back-and-forth says how many there were.
  const onlyFrom =
    messages.every((message) => message.from.teammateId === messages[0]?.from.teammateId)
      ? messages[0]?.from.teammateId
      : undefined
  const label =
    onlyFrom === undefined
      ? `${count} message${count === 1 ? '' : 's'} with`
      : onlyFrom === self?.teammateId
        ? `${count} message${count === 1 ? '' : 's'} to`
        : `${count} message${count === 1 ? '' : 's'} from`
  // What the exchange was about, for the times it stays collapsed. A count
  // alone says one happened and nothing about what it said.
  const snippet = open ? undefined : peerSnippet(messages[0]?.text ?? null)
  /*
   * WHEN it was sent, once it is old enough for that to be the question.
   *
   * A message waits for its recipient's next turn, and that turn can be a
   * conversation about something else entirely. Colin, 2026-09-14, opening a
   * new conversation to ask for one thing and finding a paragraph about a
   * database schema above it: "??? wtf is yurt doing".
   *
   * Nothing was wrong -- Yurt sent that hours earlier, in another
   * conversation, and it was delivered at the first chance. What was missing
   * is the only fact that makes it make sense: when. Under the threshold this
   * stays silent, because "sent 2 seconds ago" is the card saying it exists
   * twice.
   */
  const sentAgo = agoLabel(messages[0]?.at ?? '')
  const waited =
    messages.length === 1 && sentAgo !== undefined && !/just now|second/.test(sentAgo)
      ? sentAgo
      : undefined

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
        {waited !== undefined && <span className="lc-peer__when lc-mono">sent {waited}</span>}
        {!open && snippet !== undefined && <span className="lc-peer__snippet">{snippet}</span>}
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
                  {/* The pill above already names the sender when every
                    * message came from one side, which is the ordinary case. */}
                  {onlyFrom === undefined && (
                    <div className={`lc-peer__author is-${hue}`}>{message.from.name}</div>
                  )}
                  {/*
                    * The message itself is the way to the conversation it
                    * reached. A separate underlined "open the run this
                    * reached" under every message was clutter (Colin,
                    * 2026-09-06: "just feels clunky and isn't really needed").
                    */}
                  {onOpenPeerRun(message.messageId) !== undefined ? (
                    <button
                      type="button"
                      className={`lc-peer__bubble is-link${message.text === null ? ' is-missing' : ''}`}
                      title="Open the conversation this message reached"
                      onClick={onOpenPeerRun(message.messageId)}
                    >
                      {message.text ?? 'This message is no longer in the workroom.'}
                    </button>
                  ) : (
                    <div className={`lc-peer__bubble${message.text === null ? ' is-missing' : ''}`}>
                      {message.text ?? 'This message is no longer in the workroom.'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
