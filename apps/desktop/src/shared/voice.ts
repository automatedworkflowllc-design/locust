/** Only local PCM crosses this bridge; no URL, command, or path comes from the window. */
export const VOICE_READY = 'voice:ready'
export const VOICE_DOWNLOAD = 'voice:download'
export const VOICE_TRANSCRIBE = 'voice:transcribe'
export const VOICE_CANCEL = 'voice:cancel'
export const VOICE_PROGRESS = 'voice:progress'
export const VOICE_RATE = 16_000
export const VOICE_MAX_SECONDS = 60
export const VOICE_MAX_BYTES = 44 + VOICE_RATE * 2 * VOICE_MAX_SECONDS
export type VoiceResult = { readonly ok: true; readonly text?: string } | { readonly ok: false; readonly message: string }
export interface VoiceApi {
  ready(): Promise<boolean>
  download(): Promise<VoiceResult>
  transcribe(wav: Uint8Array): Promise<VoiceResult>
  cancel(): Promise<void>
  onProgress(listener: (percent: number) => void): () => void
}
