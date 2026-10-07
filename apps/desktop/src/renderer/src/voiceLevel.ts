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
/**
 * Whether the microphone is listening, or its words are being typed (0.686): what the chat box's glow follows.
 * Off is the resting state, and the glow then runs nothing at all.
 */
export type VoiceState = 'off' | 'listening' | 'processing'
let state: VoiceState = 'off'
const stateListeners = new Set<(next: VoiceState) => void>()
export const voiceState = {
  get: (): VoiceState => state,
  subscribe: (listener: (next: VoiceState) => void): (() => void) => {
    stateListeners.add(listener)
    listener(state)
    return () => { stateListeners.delete(listener) }
  }
}
export function setVoiceState(next: VoiceState): void {
  if (next === state) return
  state = next
  for (const listener of stateListeners) listener(state)
}

export function setVoiceLevel(rms: number): void {
  level = Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0
  for (const listener of listeners) listener(level)
}
