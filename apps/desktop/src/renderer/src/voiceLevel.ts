/** A later sound-reactive surface can subscribe; idle has no timers or work. */
let level = 0
const listeners = new Set<(rms: number) => void>()
export const voiceLevel = {
  get: (): number => level,
  subscribe: (listener: (rms: number) => void): (() => void) => {
    listeners.add(listener)
    listener(level)
    return () => { listeners.delete(listener) }
  }
}
export function setVoiceLevel(rms: number): void {
  level = Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0
  for (const listener of listeners) listener(level)
}
