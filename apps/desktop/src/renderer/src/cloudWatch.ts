import type { ClaudeCloudReading } from '../../shared/ipc.js'

// W4: "while the session's row is open, re-read it ... every 90 s".
export const CLOUD_WATCH_INTERVAL = 90_000
export const CLOUD_WATCH_LIMIT = 30 * 60_000

function content(read: ClaudeCloudReading): string {
  if (!read.ok) return JSON.stringify(read)
  const { checkedAt: _at, ...rest } = read
  return JSON.stringify(rest)
}

/** A row owns this timer and cancels it on close/unmount. No sends, only reads. */
export function startCloudWatch(options: {
  readonly check: () => Promise<ClaudeCloudReading>
  readonly initial?: ClaudeCloudReading
  readonly onReading: (reading: ClaudeCloudReading) => void
  readonly onStopped: (reason: 'unchanged' | 'time' | 'failed') => void
}): () => void {
  let active = true
  let busy = false
  let unchanged = 0
  let previous = options.initial === undefined ? undefined : content(options.initial)
  let next: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    active = false
    clearTimeout(next)
    clearTimeout(deadline)
  }
  const finish = (reason: 'unchanged' | 'time' | 'failed'): void => {
    stop()
    options.onStopped(reason)
  }
  const deadline = setTimeout(() => finish('time'), CLOUD_WATCH_LIMIT)
  const tick = async (): Promise<void> => {
    if (!active || busy) return
    busy = true
    let reading: ClaudeCloudReading
    try { reading = await options.check() }
    catch { reading = { ok: false, message: 'Claude Code could not be reached to read it. Check again.' } }
    busy = false
    if (!active) return
    options.onReading(reading)
    if (!reading.ok) { finish('failed'); return }
    const current = content(reading)
    unchanged = current === previous ? unchanged + 1 : 0
    previous = current
    if (unchanged >= 2) { finish('unchanged'); return }
    next = setTimeout(() => { void tick() }, CLOUD_WATCH_INTERVAL)
  }
  if (previous === undefined) void tick()
  else next = setTimeout(() => { void tick() }, CLOUD_WATCH_INTERVAL)
  return stop
}

export function cloudUpdatedLabel(checkedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000))
  return `Updated ${String(minutes)} min ago`
}
