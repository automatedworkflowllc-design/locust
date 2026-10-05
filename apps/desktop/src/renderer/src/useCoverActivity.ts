import { useEffect, useRef, useState } from 'react'
import type { WindowPresence } from './windowPresence.js'

export const COVER_REST_AFTER_MS = 45_000

/** One deadline, rather than a polling clock. Input and arriving work extend it. */
export function watchCoverActivity(changed: (paused: boolean) => void): { touch: () => void; stop: () => void } {
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let focused = document.hasFocus()
  let last = performance.now()
  let timer: number | undefined
  const held = (): boolean => !focused || document.hidden || motion?.matches === true
  const check = (): void => {
    window.clearTimeout(timer)
    timer = undefined
    const left = COVER_REST_AFTER_MS - (performance.now() - last)
    changed(held() || left <= 0)
    if (!held() && left > 0) timer = window.setTimeout(check, left)
  }
  const touch = (): void => {
    last = performance.now()
    if (!held()) changed(false)
    if (timer === undefined) check()
  }
  const focus = (): void => { focused = true; touch() }
  const blur = (): void => { focused = false; check() }
  const visible = (): void => { focused = document.hasFocus(); if (!held()) touch(); else check() }
  const preference = (): void => { if (!held()) touch(); else check() }
  const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const
  for (const name of events) window.addEventListener(name, touch, { passive: true })
  window.addEventListener('focus', focus)
  window.addEventListener('blur', blur)
  document.addEventListener('visibilitychange', visible)
  motion?.addEventListener('change', preference)
  check()
  return {
    touch,
    stop: () => {
      window.clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, touch)
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visible)
      motion?.removeEventListener('change', preference)
    }
  }
}

/** CSS and canvas clocks hold the same frame, without rebuilding a bot's rig. */
export function useCoverActivity(activity?: unknown): { paused: boolean; presence: WindowPresence } {
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' &&
    (!document.hasFocus() || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true))
  const held = useRef(paused)
  const watchers = useRef(new Set<() => void>())
  const presence = useRef<WindowPresence>({
    away: () => held.current,
    watch: (changed) => { watchers.current.add(changed); return () => { watchers.current.delete(changed) } }
  })
  const controller = useRef<ReturnType<typeof watchCoverActivity> | undefined>(undefined)
  useEffect(() => {
    const watching = watchCoverActivity((next) => {
      if (held.current === next) return
      held.current = next
      setPaused(next)
      for (const changed of [...watchers.current]) changed()
    })
    controller.current = watching
    return () => { watching.stop(); controller.current = undefined }
  }, [])
  useEffect(() => { controller.current?.touch() }, [activity])
  return { paused, presence: presence.current }
}
