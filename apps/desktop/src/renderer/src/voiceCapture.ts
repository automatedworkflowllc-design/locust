import workletUrl from './voiceWorklet.ts?worker&url'
import { VOICE_MAX_SECONDS, VOICE_RATE } from '../../shared/voice.js'
import { setVoiceLevel } from './voiceLevel.js'
import { voiceWav } from '../../shared/voice-pcm.js'

export interface VoiceCapture {
  stop(): Promise<Uint8Array>
  cancel(): Promise<void>
}
/** Imported only after a mic press. Capture and its audio graph do not exist at rest. */
export async function startVoiceCapture(signal: AbortSignal, atLimit: () => void): Promise<VoiceCapture> {
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  let closed = false
  let flush: (() => void) | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const chunks: Float32Array[] = []
  let count = 0
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', aborted)
    if (flushTimer !== undefined) clearTimeout(flushTimer)
    flush?.()
    node?.disconnect()
    source?.disconnect()
    if (node !== undefined) { node.port.onmessage = null; node.port.close() }
    for (const track of stream?.getTracks() ?? []) track.stop()
    setVoiceLevel(0)
    if (context !== undefined && context.state !== 'closed') await context.close()
  }
  const aborted = (): void => { void close() }
  signal.addEventListener('abort', aborted, { once: true })
  try {
    signal.throwIfAborted()
    context = new AudioContext({ sampleRate: VOICE_RATE })
    if (context.sampleRate !== VOICE_RATE) throw new Error('This microphone could not record at 16 kHz. Your message is unchanged.')
    await context.audioWorklet.addModule(workletUrl)
    signal.throwIfAborted()
    node = new AudioWorkletNode(context, 'locust-voice-pcm', { channelCount: 1, numberOfInputs: 1, numberOfOutputs: 1 })
    node.port.onmessage = (event: MessageEvent<Float32Array | string>) => {
      if (event.data === 'stopped') { flush?.(); return }
      if (closed || !(event.data instanceof Float32Array)) return
      const available = VOICE_RATE * VOICE_MAX_SECONDS - count
      const chunk = event.data.slice(0, available)
      chunks.push(chunk); count += chunk.length
      let squared = 0
      for (const value of chunk) squared += value * value
      setVoiceLevel(chunk.length === 0 ? 0 : Math.sqrt(squared / chunk.length))
      if (count >= VOICE_RATE * VOICE_MAX_SECONDS) atLimit()
    }
    // The worklet emits no audio. Connecting keeps it processing, without mic echo.
    node.connect(context.destination)
    await context.resume()
    signal.throwIfAborted()
    // Ready the graph BEFORE opening the device: a file-backed mic starts speaking
    // immediately, and opening it before addModule lost its first word in the drive.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: VOICE_RATE, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
    if (signal.aborted) { for (const track of stream.getTracks()) track.stop(); signal.throwIfAborted() }
    source = context.createMediaStreamSource(stream)
    source.connect(node)
    return {
      cancel: async () => { chunks.length = 0; await close() },
      stop: async () => {
        if (closed) throw new Error('Voice typing was cancelled. Nothing was inserted.')
        try {
          await new Promise<void>((resolve) => {
            flush = resolve
            flushTimer = setTimeout(resolve, 500)
            node!.port.postMessage('stop')
          })
          signal.throwIfAborted()
          const joined = new Float32Array(count)
          let offset = 0
          for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
          return voiceWav(joined)
        } finally { chunks.length = 0; await close() }
      }
    }
  } catch (error) { await close(); throw error }
}
