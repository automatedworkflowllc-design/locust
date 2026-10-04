import { useSyncExternalStore } from 'react'

/**
 * TERMINAL FACES (0.561), one switch every bot reads.
 *
 * Colin, 2026-10-03: "maybe im realizing they might all need a screen for a
 * face, we can have it togglable in settings, terminal face, and if the user
 * chooses to have it off it will revert back to our previous eyes." On, every
 * bot wears a dark screen with lit code eyes, as Prompt does; off, each keeps
 * its own eyes, inked glyphs for what it is doing. A bot is drawn in the
 * sidebar, the header, the Team screen, the picker and the cover, so the
 * setting lives here rather than being handed down through each of them;
 * App sets it from the stored settings. Our bots only: a pet draws its own
 * frames (Colin: "the new eyes will have to be isolated to our current
 * sprites").
 */
let terminalFaces = true
const listeners = new Set<() => void>()

export function setTerminalFaces(on: boolean): void {
  if (on === terminalFaces) return
  terminalFaces = on
  for (const listener of listeners) listener()
}

export function terminalFacesOn(): boolean {
  return terminalFaces
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTerminalFaces(): boolean {
  return useSyncExternalStore(subscribe, terminalFacesOn, terminalFacesOn)
}

/**
 * PLUSH (0.577), the other switch every bot reads. Colin, 2026-10-03, of
 * bot-avatars' new fabric: "added new shading options that look better than
 * their current plastic tone". Off unless chosen (Settings > Appearance): on,
 * every one of our bots is drawn in the library's plush faux fur instead of
 * plastic -- a short, combed pile where a bot is small, where long fibres
 * would read as fuzz (Bot.tsx). App sets it from the stored settings.
 */
let plush = false
const plushListeners = new Set<() => void>()

export function setPlush(on: boolean): void {
  if (on === plush) return
  plush = on
  for (const listener of plushListeners) listener()
}

export function plushOn(): boolean {
  return plush
}

function subscribePlush(listener: () => void): () => void {
  plushListeners.add(listener)
  return () => plushListeners.delete(listener)
}

export function usePlush(): boolean {
  return useSyncExternalStore(subscribePlush, plushOn, plushOn)
}
