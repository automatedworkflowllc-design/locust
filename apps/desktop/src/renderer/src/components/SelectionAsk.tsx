import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

/**
 * ASK ABOUT A PART OF A REPLY (a tester's feedback, 2026-09-29: "I can't
 * select a specific part of the chat to follow up on like I do using
 * chatgpt").
 *
 * Select words in a teammate's reply and a small button appears above them;
 * pressing it quotes them into the message box, above whatever is typed
 * there, so the next message is about that part. As ChatGPT's and Claude's
 * own apps do. Only a reply's text counts -- not the person's own messages,
 * not the message box.
 */
export const REPLY_SELECTOR = 'main .lc-agentline__body'
/** A quote longer than this is cut, and says so: the box is for a message, not a copy of the reply. */
export const MAX_QUOTE = 1_500

export function quoteOf(text: string): string {
  const flat = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const cut = flat.length <= MAX_QUOTE ? flat : `${flat.slice(0, MAX_QUOTE - 1).trimEnd()}…`
  return cut.split('\n').map((line) => (line.trim().length === 0 ? '>' : `> ${line}`)).join('\n')
}

export function SelectionAsk({ onAsk }: { readonly onAsk: (quote: string) => void }): ReactElement | null {
  const [shown, setShown] = useState<{ readonly text: string; readonly x: number; readonly y: number }>()
  useEffect(() => {
    const read = (): void => {
      const selection = window.getSelection()
      const text = selection?.toString() ?? ''
      if (selection === null || selection.rangeCount === 0 || text.trim().length === 0) {
        setShown(undefined)
        return
      }
      const range = selection.getRangeAt(0)
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement
      // Both ends inside ONE reply: a drag across the person's own message is not a part of a reply.
      const reply = start?.closest(REPLY_SELECTOR)
      if (reply === null || reply === undefined || end?.closest(REPLY_SELECTOR) !== reply) {
        setShown(undefined)
        return
      }
      const box = range.getBoundingClientRect()
      setShown({ text, x: Math.round(box.left + box.width / 2), y: Math.round(box.top) })
    }
    // After the mouse lifts (a drag in progress is not a choice yet), and after keys that select.
    const onUp = (): void => {
      window.setTimeout(read, 0)
    }
    const hide = (): void => setShown(undefined)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
      else if (event.shiftKey) window.setTimeout(read, 0)
    }
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])
  if (shown === undefined) return null
  return (
    <button
      type="button"
      className="lc-selectionask"
      style={{ left: shown.x, top: Math.max(8, shown.y - 38) }}
      // Pressed before the selection is lost to the click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onAsk(quoteOf(shown.text))
        window.getSelection()?.removeAllRanges()
        setShown(undefined)
      }}
    >
      Ask about this
    </button>
  )
}
