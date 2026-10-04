import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject, UIEvent } from 'react'

import { FOLLOW_TOLERANCE, nextScrollTop } from './followBottom.js'
import { atBottom, scrollVerdict } from './stickToBottom.js'

/**
 * The one scroll behaviour, for every chat surface.
 *
 * Colin, 2026-09-13: "lets have all chats auto scroll the same way claude
 * code does and also have this little drop down for if the user scrolls up
 * and wants go back down."
 *
 * Both halves were part-done. The conversation followed the bottom and eased
 * while it did (`stickToBottom.ts`, `followBottom.ts`); the room and the peer
 * thread did not follow at all, and NOTHING anywhere offered a way back down
 * once a person had scrolled up -- they had to drag the scrollbar to the end
 * themselves, which is the exact chore the following was added to remove.
 *
 * So the behaviour moves out of `Thread` and becomes this, unchanged in what
 * it does:
 *
 *   - follow the newest line only while the person is ALREADY at the bottom
 *   - stop the moment they scroll up, resume when they come back
 *   - walk rather than teleport, so a batch of text does not snap the page
 *   - offer a way back to the bottom for exactly as long as they are away
 *
 * The rules themselves and the measurements behind them are in the two files
 * this imports; this is the wiring, in one place instead of three.
 */
export interface FollowBottom {
  /** Put this on the scrolling element. */
  readonly ref: RefObject<HTMLDivElement | null>
  /** And this on its `onScroll`. */
  readonly onScroll: (event: UIEvent<HTMLElement>) => void
  /**
   * Whether the person is away from the bottom, and so whether to offer them
   * the way back. State rather than a ref precisely because it is drawn.
   */
  readonly away: boolean
  /** Take them there, walking, the way an arriving reply walks. */
  readonly toBottom: () => void
  /** Go there at once, without the walk: opening a conversation JUMPS. */
  readonly jumpNow: () => void
}

export function useFollowBottom(): FollowBottom {
  const ref = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  const lastHeight = useRef(0)
  /** The frame loop walking to the bottom; 0 when it is not running. */
  const walking = useRef(0)
  /** True for exactly the scroll event our own assignment is about to cause. */
  const ourOwnScroll = useRef(false)
  /** Where the view was at the last scroll event, ours or not: which way it went. */
  const lastTop = useRef(0)
  const [away, setAway] = useState(false)

  const stepToBottom = useCallback((): void => {
    const box = ref.current
    if (box === null) {
      walking.current = 0
      return
    }
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const target = Math.max(0, box.scrollHeight - box.clientHeight)
    const next = nextScrollTop(box.scrollTop, target, reduced)
    ourOwnScroll.current = true
    box.scrollTop = next
    walking.current = next < target ? requestAnimationFrame(stepToBottom) : 0
  }, [])

  const toBottom = useCallback((): void => {
    following.current = true
    setAway(false)
    if (walking.current === 0) walking.current = requestAnimationFrame(stepToBottom)
  }, [stepToBottom])

  const jumpNow = useCallback((): void => {
    const box = ref.current
    if (box === null) return
    following.current = true
    setAway(false)
    if (walking.current !== 0) {
      cancelAnimationFrame(walking.current)
      walking.current = 0
    }
    ourOwnScroll.current = true
    box.scrollTop = box.scrollHeight
  }, [])

  useLayoutEffect(() => {
    const box = ref.current
    if (box === null) return
    const grew = box.scrollHeight > lastHeight.current
    lastHeight.current = box.scrollHeight
    if (following.current && grew && walking.current === 0) {
      walking.current = requestAnimationFrame(stepToBottom)
    }
  })

  useEffect(
    () => () => {
      if (walking.current !== 0) cancelAnimationFrame(walking.current)
    },
    []
  )

  /*
   * Growth nobody rendered.
   *
   * The layout effect above sees growth only when THIS component renders, and
   * a fold opening or a diff laying itself out grows the thread from inside a
   * child that renders alone -- so the content is watched for size directly.
   * Re-attached whenever the content element changes, so a surface that draws
   * its scroller after mounting is watched too.
   */
  const watched = useRef<{ readonly node: Element; readonly observer: ResizeObserver } | undefined>(undefined)
  useLayoutEffect(() => {
    const box = ref.current
    const content = box?.firstElementChild ?? null
    if (watched.current?.node === content) return
    watched.current?.observer.disconnect()
    watched.current = undefined
    if (box === null || content === null || typeof ResizeObserver === 'undefined') return
    // Where the view starts, so the first scroll a person makes is measured
    // from where it really was -- from 0, a first move up reads as a move down.
    lastTop.current = box.scrollTop
    /*
     * AND THE VIEW ITSELF (0.409). A window made shorter shrinks the scroller
     * while its scrollTop stays: the bottom slides out of sight with no growth
     * and no scroll event, so a person who was AT the newest reply was left
     * above it (fresh-eyes check, a conversation at 1440x900 then 1120x720:
     * "DONE" below the view). A view that got shorter while following is
     * taken back to the bottom.
     */
    let lastView = box.clientHeight
    const observer = new ResizeObserver(() => {
      const grew = box.scrollHeight > lastHeight.current
      lastHeight.current = box.scrollHeight
      const shrank = box.clientHeight < lastView
      lastView = box.clientHeight
      if (following.current && (grew || shrank) && walking.current === 0) {
        walking.current = requestAnimationFrame(stepToBottom)
      }
    })
    observer.observe(content)
    observer.observe(box)
    watched.current = { node: content, observer }
  })

  useEffect(
    () => () => {
      watched.current?.observer.disconnect()
    },
    []
  )

  const onScroll = useCallback((event: UIEvent<HTMLElement>): void => {
    /*
     * Our own step is not the person scrolling away.
     *
     * While the walk is in flight the view is BY DEFINITION not at the
     * bottom, so reading these events as a person's would stop following on
     * the first frame of every batch -- the animation would cancel itself and
     * the following would do nothing at all.
     */
    const top = event.currentTarget.scrollTop
    const movedUp = top < lastTop.current - 1
    lastTop.current = top
    if (ourOwnScroll.current) {
      ourOwnScroll.current = false
      return
    }
    const verdict = scrollVerdict({
      atBottom: atBottom(event.currentTarget, FOLLOW_TOLERANCE),
      movedUp,
      following: following.current
    })
    if (verdict === 'follow') {
      following.current = true
      setAway(false)
      return
    }
    if (verdict === 'leave') {
      following.current = false
      setAway(true)
      if (walking.current !== 0) {
        cancelAnimationFrame(walking.current)
        walking.current = 0
      }
      return
    }
    // Short of the bottom and nobody moved it there: keep following.
    if (verdict === 'catch-up' && walking.current === 0) {
      walking.current = requestAnimationFrame(stepToBottom)
    }
  }, [stepToBottom])

  return { ref, onScroll, away, toBottom, jumpNow }
}
