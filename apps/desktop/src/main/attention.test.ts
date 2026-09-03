import { describe, expect, it } from 'vitest'

import { approvalNotificationText, createAttention, shouldNotify } from './attention.js'

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
