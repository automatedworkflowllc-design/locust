import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVoiceCapture } from './voiceCapture.js'
import { voiceLevel } from './voiceLevel.js'

vi.mock('./voiceWorklet.ts?worker&url', () => ({ default: '/local-worklet.js' }))
const order: string[] = []
const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] } as unknown as MediaStream
let context: FakeContext
let node: FakeNode
class FakeContext {
  sampleRate = 16000
  state = 'running'
  destination = {}
  audioWorklet = { addModule: vi.fn(async () => { order.push('worklet') }) }
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  resume = vi.fn(async () => { order.push('resume') })
  close = vi.fn(async () => { this.state = 'closed' })
  constructor() { context = this; order.push('context') }
}
class FakeNode {
  port = {
    onmessage: undefined as undefined | ((event: { data: string | Float32Array }) => void),
    postMessage: vi.fn(() => { queueMicrotask(() => this.port.onmessage?.({ data: 'stopped' })) }),
    close: vi.fn()
  }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { node = this }
}
const mic = vi.fn(async () => { order.push('mic'); return stream })
beforeEach(() => {
  order.length = 0
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mic } })
  mic.mockImplementation(async () => { order.push('mic'); return stream })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('voice capture closes every track', () => {
  it('readies the graph before opening audio and stops tracks, context, and port', async () => {
    const capture = await startVoiceCapture(new AbortController().signal, () => undefined)
    expect(order).toEqual(['context', 'worklet', 'resume', 'mic'])
    node.port.onmessage?.({ data: new Float32Array([0.5, -0.5]) })
    expect(voiceLevel.get()).toBe(0.5)
    const wav = await capture.stop()
    expect(wav.byteLength).toBe(48)
    expect(new DataView(wav.buffer as ArrayBuffer).getUint32(24, true)).toBe(16000)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(node.port.close).toHaveBeenCalledTimes(1)
    expect(voiceLevel.get()).toBe(0)
  })
  it('closes the audio graph when microphone access is denied', async () => {
    mic.mockRejectedValueOnce(new Error('Microphone denied'))
    await expect(startVoiceCapture(new AbortController().signal, () => undefined)).rejects.toThrow('denied')
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(node.disconnect).toHaveBeenCalledTimes(1)
  })
  it('stops even a device granted after Escape while its prompt was pending', async () => {
    let grant!: (stream: MediaStream) => void
    mic.mockImplementationOnce(() => new Promise((resolve) => { grant = resolve }))
    const controller = new AbortController()
    const start = startVoiceCapture(controller.signal, () => undefined)
    const rejected = expect(start).rejects.toBeDefined()
    await vi.waitFor(() => { expect(mic).toHaveBeenCalled() })
    controller.abort(); grant(stream)
    await rejected
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
  })
  it('cancel returns no WAV and clears RMS', async () => {
    const capture = await startVoiceCapture(new AbortController().signal, () => undefined)
    node.port.onmessage?.({ data: new Float32Array([1]) })
    await expect(capture.cancel()).resolves.toBeUndefined()
    await expect(capture.stop()).rejects.toThrow('cancelled')
    expect(voiceLevel.get()).toBe(0)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
