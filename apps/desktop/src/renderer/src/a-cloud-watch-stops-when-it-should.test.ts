// Colin: "use fakes only". W4: "stop when two reads in a row bring nothing new,
// after 30 minutes, or when the row closes".
import { afterEach, expect, it, vi } from 'vitest'
import { CLOUD_WATCH_INTERVAL, CLOUD_WATCH_LIMIT, cloudUpdatedLabel, startCloudWatch } from './cloudWatch.js'
import type { ClaudeCloudReading } from '../../shared/ipc.js'

afterEach(() => { vi.useRealTimers() })
const reading = (answer = 'First', at = '2026-10-03T00:00:00Z'): ClaudeCloudReading => ({ ok: true, checkedAt: at, exchanges: [{ prompt: 'Test', answer, at: '2026-10-03T00:00:00Z' }] })
function watch(check = vi.fn(async () => reading()), initial: ClaudeCloudReading | undefined = reading()) {
  vi.useFakeTimers()
  const onReading = vi.fn()
  const onStopped = vi.fn()
  const stop = startCloudWatch({ check, ...(initial === undefined ? {} : { initial }), onReading, onStopped })
  return { check, onReading, onStopped, stop }
}
it('Watch reads every ninety seconds and stops after two unchanged reads despite new timestamps.', async () => {
  const w = watch(vi.fn(async () => reading('First', new Date(Date.now()).toISOString())))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_INTERVAL - 1)
  expect(w.check).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(w.check).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_INTERVAL * 3)
  expect(w.check).toHaveBeenCalledTimes(2)
  expect(w.onStopped).toHaveBeenCalledWith('unchanged')
})
it('Watch resets its unchanged count when a reply or change arrives.', async () => {
  let n = 0
  const w = watch(vi.fn(async () => reading(++n < 2 ? 'First' : 'Second')))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_INTERVAL * 3)
  expect(w.check).toHaveBeenCalledTimes(3)
  expect(w.onStopped).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_INTERVAL)
  expect(w.onStopped).toHaveBeenCalledWith('unchanged')
})
it('Watch stops after thirty minutes even when every read brings something new.', async () => {
  let n = 0
  const w = watch(vi.fn(async () => reading(String(++n))))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_LIMIT + CLOUD_WATCH_INTERVAL)
  expect(w.check).toHaveBeenCalledTimes(19)
  expect(w.onStopped).toHaveBeenCalledWith('time')
})
it('Closing a row cancels Watch and ignores a read that finishes afterward.', async () => {
  let finish!: (value: ClaudeCloudReading) => void
  const w = watch(vi.fn(() => new Promise<ClaudeCloudReading>((resolve) => { finish = resolve })))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_INTERVAL)
  w.stop()
  finish(reading())
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_LIMIT)
  expect(w.check).toHaveBeenCalledTimes(1)
  expect(w.onReading).not.toHaveBeenCalled()
  expect(w.onStopped).not.toHaveBeenCalled()
})
it('Watch never overlaps slow reads and stops at its deadline while a read is pending.', async () => {
  const w = watch(vi.fn(() => new Promise<ClaudeCloudReading>(() => undefined)))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_LIMIT + CLOUD_WATCH_INTERVAL)
  expect(w.check).toHaveBeenCalledTimes(1)
  expect(w.onStopped).toHaveBeenCalledWith('time')
})
it('Watch reports a failed read once and schedules no further reads.', async () => {
  const w = watch(vi.fn(async () => { throw new Error('offline') }))
  await vi.advanceTimersByTimeAsync(CLOUD_WATCH_LIMIT)
  expect(w.check).toHaveBeenCalledTimes(1)
  expect(w.onReading).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
  expect(w.onStopped).toHaveBeenCalledWith('failed')
})
it('The row names the number of minutes since its last successful read.', () => {
  expect(cloudUpdatedLabel('2026-10-03T00:00:00Z', Date.parse('2026-10-03T00:02:59Z'))).toBe('Updated 2 min ago')
})
