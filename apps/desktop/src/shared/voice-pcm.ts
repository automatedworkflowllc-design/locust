import { VOICE_MAX_BYTES, VOICE_RATE } from './voice.js'
export function voiceWav(samples: Float32Array): Uint8Array {
  if (samples.length * 2 + 44 > VOICE_MAX_BYTES) throw new Error('The recording reached one minute. Stop voice typing to insert it.')
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const word = (offset: number, text: string): void => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i) }
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, VOICE_RATE, true); view.setUint32(28, VOICE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

export function insertVoiceText(value: string, text: string, start: number, end: number, limit: number): { text: string; cursor: number } {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const inserted = text.trim().slice(0, Math.max(0, limit - before.length - after.length))
  return { text: before + inserted + after, cursor: before.length + inserted.length }
}
