import { describe, expect, it } from 'vitest'

import { approvalNotificationText, createAttention, ROOM_TOAST_LINES, ROOM_TOAST_WINDOW_MS, roomNotificationText, shouldNotify } from './attention.js'

describe('when an approval earns a notification', () => {
  it('only when the window is not in front, and only where the OS can show one', () => {
    expect(shouldNotify({ focused: false, supported: true })).toBe(true)
    expect(shouldNotify({ focused: true, supported: true })).toBe(false)
    expect(shouldNotify({ focused: false, supported: false })).toBe(false)
  })

  it('names the teammate and the action, never the exact command', () => {
    const text = approvalNotificationText({ kind: 'command', summary: 'Run a command' }, 'Wren')
    expect(text.title).toBe('Wren needs your approval')
    expect(text.body).toBe('Run a command · the run is paused until you answer.')
    expect(approvalNotificationText({ kind: 'question', summary: 'Answer a question' }, undefined).title).toBe('A teammate has a question')
  })

  it('shows the notification and brings the window forward on click', () => {
    const shown: { title: string; body: string; onClick: () => void }[] = []
    let focused = 0
    const attention = createAttention({
      focused: () => false,
      supported: () => true,
      notify: (input) => shown.push(input),
      focusWindow: () => {
        focused += 1
      }
    })
    expect(attention.approvalArrived({ kind: 'file-change', summary: 'Change 2 files' }, 'Booty')).toBe(true)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe('Booty needs your approval')
    shown[0]?.onClick()
    expect(focused).toBe(1)
  })

  it('stays quiet while the window has attention', () => {
    const shown: unknown[] = []
    const attention = createAttention({ focused: () => true, supported: () => true, notify: (input) => shown.push(input), focusWindow: () => undefined })
    expect(attention.approvalArrived({ kind: 'command', summary: 'Run a command' }, 'Wren')).toBe(false)
    expect(shown).toHaveLength(0)
  })
})

/**
 * A clock the tests own: schedule() records tasks with their due time and
 * advance() runs the ones that fell due, in order. Nothing here sleeps.
 */
function clock() {
  let now = 0
  const due: { at: number; task: () => void; live: boolean }[] = []
  return {
    timers: {
      schedule: (task: () => void, ms: number) => {
        const entry = { at: now + ms, task, live: true }
        due.push(entry)
        return entry
      },
      clear: (handle: unknown) => {
        ;(handle as { live: boolean }).live = false
      }
    },
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const next = due.filter((entry) => entry.live && entry.at <= until).sort((a, b) => a.at - b.at)[0]
        if (next === undefined) break
        now = next.at
        next.live = false
        next.task()
      }
      now = until
    }
  }
}

function roomHarness(focused = false) {
  const shown: { title: string; body: string }[] = []
  const time = clock()
  const attention = createAttention(
    { focused: () => focused, supported: () => true, notify: (input) => shown.push({ title: input.title, body: input.body }), focusWindow: () => undefined },
    time.timers
  )
  return { attention, shown, time }
}

describe('when a room changes while the person is elsewhere', () => {
  it('says one change by the room’s name, after the window, not before', () => {
    const { attention, shown, time } = roomHarness()
    attention.roomChanged({ roomId: 'room_r', roomName: 'Release', message: 'Wren finished "Write the notes".' })
    expect(shown).toHaveLength(0)
    time.advance(ROOM_TOAST_WINDOW_MS - 1)
    expect(shown).toHaveLength(0)
    time.advance(1)
    expect(shown).toEqual([{ title: 'Release', body: 'Wren finished "Write the notes".' }])
  })

  it('gathers a burst into ONE toast: three teammates finishing together are one thing to read', () => {
    const { attention, shown, time } = roomHarness()
    for (const who of ['Wren', 'Booty', 'Atlas']) {
      attention.roomChanged({ roomId: 'room_r', roomName: 'Release', message: `${who} took on "Ship it".` })
      time.advance(1_000)
    }
    time.advance(ROOM_TOAST_WINDOW_MS)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.title).toBe('Release · 3 changes')
    expect(shown[0]?.body.split(String.fromCharCode(10))).toHaveLength(3)
  })

  it('keeps a long burst readable: the newest lines and a count of the rest', () => {
    const text = roomNotificationText('Release', Array.from({ length: 12 }, (_, i) => `change ${String(i + 1)}`))
    expect(text.title).toBe('Release · 12 changes')
    const lines = text.body.split(String.fromCharCode(10))
    expect(lines).toHaveLength(ROOM_TOAST_LINES + 1)
    expect(lines[0]).toBe('… and 9 more')
    expect(lines.at(-1)).toBe('change 12')
  })

  it('MEASURED: three teammates unattended for ten minutes are a readable set of toasts, not a storm', () => {
    // The spec's bar for shipping this (vision #2). Three teammates, each
    // ending a run about every ninety seconds at staggered times, each run
    // moving the board once: twenty changes in ten minutes.
    const { attention, shown, time } = roomHarness()
    const names = ['Wren', 'Booty', 'Atlas']
    let changes = 0
    for (let second = 0; second < 600; second += 1) {
      names.forEach((who, index) => {
        if ((second + index * 30) % 90 === 0) {
          attention.roomChanged({ roomId: 'room_r', roomName: 'Release', message: `${who} moved the board (${String(second)}s).` })
          changes += 1
        }
      })
      time.advance(1_000)
    }
    time.advance(ROOM_TOAST_WINDOW_MS)
    expect(changes).toBe(20)
    // One toast per window that saw a change is the ceiling; the stagger
    // means most windows see one or two changes.
    expect(shown.length).toBeLessThanOrEqual(Math.ceil(600 / (ROOM_TOAST_WINDOW_MS / 1000)))
    // The first cut of this window was twenty seconds, and this line went
    // red at exactly twenty toasts for twenty changes: runs ending thirty
    // seconds apart never shared a window. Two minutes is the number that
    // turned a storm into a set.
    expect(shown.length).toBeLessThanOrEqual(5)
    expect(shown.length).toBeLessThan(changes)
    for (const toast of shown) {
      expect(toast.body.split(String.fromCharCode(10)).length).toBeLessThanOrEqual(ROOM_TOAST_LINES + 1)
    }
    // Every change was said somewhere, none twice.
    const said = shown.reduce((sum, toast) => sum + Number(/(\d+) changes/.exec(toast.title)?.[1] ?? 1), 0)
    expect(said).toBe(changes)
  })

  it('says nothing while the window has attention -- the room screen already does', () => {
    const { attention, shown, time } = roomHarness(true)
    attention.roomChanged({ roomId: 'room_r', roomName: 'Release', message: 'Wren finished "Write the notes".' })
    time.advance(ROOM_TOAST_WINDOW_MS)
    expect(shown).toHaveLength(0)
    expect(attention.pending().size).toBe(0)
  })

  it('keeps rooms apart', () => {
    const { attention, shown, time } = roomHarness()
    attention.roomChanged({ roomId: 'room_a', roomName: 'Alpha', message: 'a' })
    attention.roomChanged({ roomId: 'room_b', roomName: 'Beta', message: 'b' })
    time.advance(ROOM_TOAST_WINDOW_MS)
    expect(shown.map((toast) => toast.title).sort()).toEqual(['Alpha', 'Beta'])
  })
})
