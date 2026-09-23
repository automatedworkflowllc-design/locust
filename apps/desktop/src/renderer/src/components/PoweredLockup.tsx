import { useEffect, useRef, useState } from 'react'
import type { AnimationEvent, ReactElement } from 'react'

import markSvg from '../assets/locust-mark.svg?raw'
import type { TubePreference } from '../../../shared/ipc.js'

/**
 * THE LOCKUP, POWERING ON.
 *
 * Colin, 2026-09-22, having seen it on the design system's cover: "what if we
 * put this animation where our current logo goes on the splash page here?
 * just make sure it starts playing after the probing process, and maybe run
 * that weird green crt effect every 7-10 seconds so if the user missed it
 * they can see it again ... We will need stuff like that to promote."
 *
 * The boot screen in miniature: the lockup catches in the tube's lime with a
 * flicker, one sweep passes down the glass, and it cools to the app's ink.
 * It waits for the app to be in front of someone -- the window is held
 * hidden behind the loading screen until probing is done, and a hidden
 * window cannot have focus -- so the first lighting is never spent behind
 * the loading screen. After that it relights every 7 to 10 seconds, at an
 * interval that varies so it never reads as a metronome.
 *
 * It answers to the boot screen's own preference, because it is the same
 * tube: Full lights and relights, Subtle lights once, Off never does. And
 * reduced motion stops all of it: the still lockup is the finished one.
 *
 * The mark is the traced file, drawn inline rather than as an image, because
 * an image cannot take a colour. The name is live type, set the way the
 * design system's cover sets it -- Figtree 700 capitals at the title
 * tracking -- because the home screen is that cover now (see HomeCover) and
 * the traced wordmark is a lighter drawing: side by side at the same width,
 * its letters are thinner and shorter than the cover's (Colin, of the cover:
 * "it can be a 1:1").
 */

/** The traced path of one of the brand files. */
function traced(svg: string): { readonly viewBox: string; readonly d: string } {
  return {
    viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 1 1',
    d: /<path[^>]*\sd="([^"]+)"/.exec(svg)?.[1] ?? ''
  }
}

const MARK = traced(markSvg)

/** How the lockup lights, from the boot screen's preference and the system's motion setting. */
export function lightingPlan(tube: TubePreference, reducedMotion: boolean): 'none' | 'once' | 'repeat' {
  if (reducedMotion || tube === 'off') return 'none'
  return tube === 'full' ? 'repeat' : 'once'
}

/** The wait before the next lighting: 7 to 10 seconds, never the same twice in a row by design. */
export function nextLightingDelay(random: () => number = Math.random): number {
  return 7_000 + Math.round(Math.min(1, Math.max(0, random())) * 3_000)
}

/**
 * Whether a click on the glass lights it again: once it has lit on its own,
 * and as the tube allows -- Off and reduced motion never light, so a click
 * does not either.
 */
export function replaysOnAsk(plan: 'none' | 'once' | 'repeat', litSoFar: number): boolean {
  return plan !== 'none' && litSoFar > 0
}

const LIGHTINGS = new Set(['lcLockupPower', 'lcLockupRelight'])

export function PoweredLockup({
  ready,
  tube,
  replay = 0
}: {
  /** The runtimes have answered: the loading screen's work is done. */
  readonly ready: boolean
  readonly tube: TubePreference
  /** Counts up for each time someone asks to see it power on again: a click on the glass. */
  readonly replay?: number
}): ReactElement {
  const [inFront, setInFront] = useState(() => typeof document !== 'undefined' && document.hasFocus())
  const [lighting, setLighting] = useState<'power' | 'relight'>()
  const [waitRound, setWaitRound] = useState(0)
  const lit = useRef(0)
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const plan = lightingPlan(tube, reduced)

  // In front of someone: focused, or under their pointer.
  useEffect(() => {
    if (inFront) return undefined
    const arrived = (): void => setInFront(true)
    window.addEventListener('focus', arrived)
    window.addEventListener('pointermove', arrived)
    return () => {
      window.removeEventListener('focus', arrived)
      window.removeEventListener('pointermove', arrived)
    }
  }, [inFront])

  // The first lighting: after probing, once someone can see it.
  useEffect(() => {
    if (!ready || !inFront || plan === 'none' || lit.current > 0) return
    lit.current = 1
    setLighting('power')
  }, [ready, inFront, plan])

  // Again, 7 to 10 seconds after each one ends -- only while the window is visible.
  useEffect(() => {
    if (lighting !== undefined || lit.current === 0 || plan !== 'repeat') return undefined
    const timer = window.setTimeout(() => {
      if (document.hidden) {
        setWaitRound((round) => round + 1)
        return
      }
      lit.current += 1
      setLighting('relight')
    }, nextLightingDelay())
    return () => window.clearTimeout(timer)
  }, [lighting, plan, waitRound])

  /*
   * ASKED FOR AGAIN. A click on the glass powers it on again (Colin's "have
   * fun" list, 2026-09-23: "you can run all those") -- the power-on, not the
   * relight, because the power-on is the one people miss. Once it has lit
   * the first time, and only as the tube allows: Off and reduced motion
   * never light, so a click does not either. A click while it is lighting
   * lets that lighting finish.
   */
  useEffect(() => {
    if (replay === 0 || !replaysOnAsk(plan, lit.current)) return
    lit.current += 1
    setLighting((current) => current ?? 'power')
    // Only a new ask replays: a changed plan is not one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay])

  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>): void => {
    if (LIGHTINGS.has(event.animationName)) setLighting(undefined)
  }

  return (
    <div
      className={`lc-lockup${lighting === 'power' ? ' is-powering' : lighting === 'relight' ? ' is-relighting' : ''}`}
      role="img"
      aria-label="Locust"
      onAnimationEnd={onAnimationEnd}
    >
      <svg className="lc-lockup__mark" viewBox={MARK.viewBox} aria-hidden="true" focusable="false">
        <path fillRule="evenodd" d={MARK.d} />
      </svg>
      <span className="lc-lockup__name" aria-hidden="true">
        Locust
      </span>
      <span className="lc-lockup__tube" aria-hidden="true">
        <span className="lc-lockup__scan" />
        <span className="lc-lockup__sweep" />
      </span>
    </div>
  )
}
