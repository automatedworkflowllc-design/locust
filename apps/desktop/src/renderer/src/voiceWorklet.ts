declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class VoicePcm extends AudioWorkletProcessor {
  private recording = true
  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<string>) => {
      if (event.data === 'stop') {
        this.recording = false
        this.port.postMessage('stopped') // Ordered after every PCM chunk already posted.
      }
    }
  }
  process(inputs: Float32Array[][]): boolean {
    const mono = inputs[0]?.[0]
    if (this.recording && mono !== undefined) {
      const copy = new Float32Array(mono)
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}
registerProcessor('locust-voice-pcm', VoicePcm)
export {}
