import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { VoiceApi, VoiceResult } from '../../shared/voice.js'
import { VoiceButton, VOICE_DOWNLOAD_WORDS } from './components/VoiceButton.js'
import { insertVoiceText, voiceWav } from '../../shared/voice-pcm.js'
import { setVoiceLevel, voiceLevel } from './voiceLevel.js'

const mocks = vi.hoisted(() => ({ cleanups: [] as (() => void)[], stop: vi.fn(), cancel: vi.fn(), start: vi.fn() }))
// Tiny hook harness: exercise the real button handlers without a new DOM dependency.
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (effect: () => undefined | (() => void)) => { const cleanup = effect(); if (cleanup) mocks.cleanups.push(cleanup) }
}))
vi.mock('./voiceCapture.js', () => ({ startVoiceCapture: mocks.start }))
let surface: EventTarget
beforeEach(() => {
  surface = new EventTarget(); vi.stubGlobal('window', surface)
  mocks.start.mockResolvedValue({ stop: mocks.stop, cancel: mocks.cancel })
  mocks.cancel.mockResolvedValue(undefined)
  mocks.stop.mockResolvedValue(voiceWav(new Float32Array(16)))
})
afterEach(() => { for (const cleanup of mocks.cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); setVoiceLevel(0) })
function api(): VoiceApi {
  return { ready: vi.fn(async () => true), download: vi.fn(async () => ({ ok: true as const })),
    transcribe: vi.fn(async () => ({ ok: true as const, text: 'Local words.' })), cancel: vi.fn(async () => undefined), onProgress: () => () => undefined }
}
function press(element: ReactElement): void {
  const button = (element.props as { children: ReactElement[] }).children[0]
  ;(button!.props as { onClick(): void }).onClick()
}
function escape(): void {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperty(event, 'key', { value: 'Escape' })
  surface.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
}
describe('voice typing is editable and cancellable', () => {
  it.each(['darwin', 'linux', 'unknown'])('does not draw a microphone on %s', (platform) => {
    expect(renderToStaticMarkup(<VoiceButton platform={platform} onText={() => undefined} api={api()} />)).toBe('')
  })
  it('draws it on Windows and loads nothing on mount', () => {
    const bridge = api()
    expect(renderToStaticMarkup(<VoiceButton platform="win32" onText={() => undefined} api={bridge} />)).toContain('aria-label="Voice typing"')
    expect(bridge.ready).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(VOICE_DOWNLOAD_WORDS).toBe('Voice typing needs a one-time 41 MB download. It runs on this computer; nothing you say leaves it.')
  })
  it('Esc cancels recording and inserts nothing', async () => {
    const bridge = api(); const insert = vi.fn()
    const element = VoiceButton({ platform: 'win32', api: bridge, onText: insert })!
    press(element)
    await vi.waitFor(() => { expect(mocks.start).toHaveBeenCalled() })
    await Promise.resolve()
    escape()
    expect(mocks.cancel).toHaveBeenCalled()
    expect(bridge.transcribe).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it('Esc while transcription is pending discards even a late success', async () => {
    const bridge = api(); const insert = vi.fn()
    let finish!: (result: VoiceResult) => void
    bridge.transcribe = vi.fn(() => new Promise<VoiceResult>((resolve) => { finish = resolve }))
    const element = VoiceButton({ platform: 'win32', api: bridge, onText: insert })!
    press(element)
    await vi.waitFor(() => { expect(mocks.start).toHaveBeenCalled() })
    press(element)
    await vi.waitFor(() => { expect(bridge.transcribe).toHaveBeenCalled() })
    escape(); finish({ ok: true, text: 'Must not arrive.' })
    await Promise.resolve(); await Promise.resolve()
    expect(bridge.cancel).toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
  it('a second press inserts returned words once, not a send', async () => {
    const bridge = api(); const insert = vi.fn()
    const element = VoiceButton({ platform: 'win32', api: bridge, onText: insert })!
    press(element)
    await vi.waitFor(() => { expect(mocks.start).toHaveBeenCalled() })
    press(element)
    await vi.waitFor(() => { expect(insert).toHaveBeenCalledExactlyOnceWith('Local words.') })
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })
  it('inserts at the cursor, replaces a selection, and preserves surrounding edits', () => {
    expect(insertVoiceText('before  after', 'words', 7, 7, 8000)).toEqual({ text: 'before words after', cursor: 12 })
    expect(insertVoiceText('before old after', 'new', 7, 10, 8000)).toEqual({ text: 'before new after', cursor: 10 })
    expect(insertVoiceText('abcd', '123456', 2, 2, 6)).toEqual({ text: 'ab12cd', cursor: 4 })
  })
  it('produces canonical mono PCM and clamps live RMS for subscribers', () => {
    const wav = voiceWav(new Float32Array([-2, 0, 2]))
    const view = new DataView(wav.buffer)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(48, true)).toBe(32767)
    const heard = vi.fn(); const unsubscribe = voiceLevel.subscribe(heard)
    setVoiceLevel(0.4); setVoiceLevel(2); setVoiceLevel(NaN); unsubscribe(); setVoiceLevel(0.2)
    expect(heard.mock.calls.map(([level]) => level)).toEqual([0, 0.4, 1, 0])
    expect(voiceLevel.get()).toBe(0.2)
  })
})
