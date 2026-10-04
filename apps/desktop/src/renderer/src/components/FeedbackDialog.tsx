import { useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { useModal } from '../useModal.js'
import { SUPPORT_ADDRESS } from '../../../shared/support.js'

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
  // The private ways (0.593, R23): the mail app, or a file saved whole.
  const [saved, setSaved] = useState<string>()
  const report = (): { description: string; conversation?: string } => ({ description: text.trim(), ...(conversation === undefined || !withConversation ? {} : { conversation }) })
  const email = (): void => {
    if (!ready) return
    const bridge = window.desktop
    if (bridge === undefined) return
    setSending(true)
    setRefused(undefined)
    void bridge.emailFeedback(report()).then((opened) => {
      if (opened.ok) {
        onClose()
        return
      }
      setRefused(opened.message)
      setSending(false)
    }).catch(() => {
      setRefused('Your mail app could not be opened. What you wrote is still here.')
      setSending(false)
    })
  }
  const saveFile = (): void => {
    if (!ready) return
    const bridge = window.desktop
    if (bridge === undefined) return
    setSending(true)
    setRefused(undefined)
    void bridge.saveFeedbackFile(report()).then((written) => {
      setSending(false)
      if (!written.ok) {
        setRefused(written.message ?? 'The report could not be saved. What you wrote is still here; Email or Send still work.')
        return
      }
      if (written.path !== undefined) setSaved(written.path)
    }).catch(() => {
      setRefused('The report could not be saved. What you wrote is still here.')
      setSending(false)
    })
  }
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
          {saved !== undefined && <p className="lc-feedback__claim" role="status">Saved to {saved}. Send it to {SUPPORT_ADDRESS}, or attach it to an issue.</p>}
          <p className="lc-feedback__claim">
            Send opens a public GitHub issue (an account is needed). Email opens your mail app to {SUPPORT_ADDRESS}, which only Locust&rsquo;s makers read; a long conversation may not fit an email, and Save as a file keeps all of it.
          </p>
        </div>
        <div className="lc-dialog__foot">
          <button type="button" className="lc-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="lc-ghostbutton" disabled={!ready} onClick={saveFile}>
            Save as a file
          </button>
          <button type="button" className="lc-ghostbutton" disabled={!ready} onClick={email}>
            Email
          </button>
          <button type="button" className="lc-primarybutton" disabled={!ready} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
