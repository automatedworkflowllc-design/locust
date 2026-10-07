import type { VoiceResult } from '../shared/voice.js'
export const VOICE_OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
export const VOICE_OPENAI_MODEL = 'gpt-4o-transcribe'

/** No user-selected address, redirects, logs, or raw server errors carrying the key. */
export async function transcribeOpenAI(wav: Uint8Array, key: string | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<VoiceResult> {
  if (!key) return { ok: false, message: 'Add your OpenAI API key in Settings > General. Your message is unchanged.' }
  const body = new FormData()
  body.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
  body.append('model', VOICE_OPENAI_MODEL)
  body.append('response_format', 'json')
  body.append('language', 'en')
  try {
    const response = await fetcher(VOICE_OPENAI_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), credentials: 'omit', redirect: 'error' })
    if (response.status === 401 || response.status === 403) return { ok: false, message: 'OpenAI refused your API key. Check it in Settings > General. Your message is unchanged.' }
    if (!response.ok) return { ok: false, message: 'OpenAI could not transcribe this recording. Check your API account and try again. Your message is unchanged.' }
    const result: unknown = await response.json()
    signal.throwIfAborted()
    if (typeof result !== 'object' || result === null || !('text' in result) || typeof result.text !== 'string' || result.text.length > 256_000 || result.text.includes(key)) throw new Error('invalid transcript')
    return { ok: true, text: result.text }
  } catch { return { ok: false, message: signal.aborted ? 'Voice typing was cancelled. Nothing was inserted.' : 'OpenAI could not be reached. Your message is unchanged; try again.' } }
}
