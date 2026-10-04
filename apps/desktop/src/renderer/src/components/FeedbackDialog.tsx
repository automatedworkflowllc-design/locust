import { useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { useModal } from '../useModal.js'

/** The words the host keeps (main/report-problem.ts MAX_DESCRIPTION). */
const MOST = 2_000

/**
 * SEND FEEDBACK, THE WAY CLAUDE CODE ASKS FOR IT.
 *
 * Colin, 2026-09-23, with Claude Code's own box beside him: "for bug
 * reporting we can use what claude code does". One box to describe the
 * issue, one line that says exactly what goes with it, Cancel and Send.
 *
 * What differs is where Send goes. Claude Code sends to its makers' own
 * service; Locust has none, and no telemetry. So Send opens the finished
 * report on GitHub in the person's browser, and they send it there -- which
 * the line says, so nobody thinks it has already gone.
 *
 * AND IT IS PUBLIC. The issue lands on the public releases repository, where
 * anyone can read it, and the conversation it was opened from went with it
 * unasked. Colin, 2026-09-29, ran with the suggestion: keep GitHub, say it
 * is public before it opens, and send the conversation only when ticked.
 */
export function FeedbackDialog({
  conversation,
  onClose
}: {
  /** The conversation it was opened from, as plain text; undefined from Settings. */
  readonly conversation?: string
  readonly onClose: () => void
}): ReactElement {
  const [text, setText] = useState('')
  const [withConversation, setWithConversation] = useState(false)
  const [sending, setSending] = useState(false)
  const [refused, setRefused] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  useModal(box, onClose)
  const ready = text.trim().length > 0 && !sending
  const send = (): void => {
    if (!ready) return
    const bridge = window.desktop
    if (bridge === undefined) {
      setRefused('Locust is not ready yet.')
      return
    }
    setSending(true)
    setRefused(undefined)
    void bridge
      .sendFeedback({ description: text.trim(), ...(conversation === undefined || !withConversation ? {} : { conversation }) })
      .then((opened) => {
        if (opened.ok) {
          onClose()
          return
        }
        setRefused(opened.message)
        setSending(false)
      })
      .catch(() => {
        setRefused('Your browser could not be opened. What you wrote is still here.')
        setSending(false)
      })
  }
  return (
    <div className="lc-scrim">
      <div ref={box} className="lc-dialog lc-feedback" role="dialog" aria-modal="true" aria-label="Send feedback">
        <div className="lc-dialog__head">
          <span className="lc-dialog__title">Send feedback</span>
        </div>
        <div className="lc-dialog__body lc-feedback__body">
          <textarea
            className="lc-input lc-feedback__text"
            placeholder="Describe the issue"
            aria-label="Describe the issue"
            value={text}
            maxLength={MOST}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                send()
              }
            }}
          />
          {conversation !== undefined && (
            <label className="lc-feedback__with">
              <input type="checkbox" checked={withConversation} onChange={(event) => setWithConversation(event.target.checked)} />
              <span>Include this conversation</span>
            </label>
          )}
          <p className="lc-feedback__claim">
            {`This report will include your description${withConversation && conversation !== undefined ? ', this conversation,' : ''} and your Locust and ${typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'macOS' : 'Windows'} versions. It opens on GitHub as a public issue that anyone can read, and you send it from there.`}
          </p>
          {refused !== undefined && <p className="lc-feedback__claim lc-tone-amber">{refused}</p>}
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="lc-primarybutton" disabled={!ready} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
