import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { failedOnItsLimit } from './missionView.js'
import { Thread } from './components/Thread.js'

/**
 * AN ENDED RUN OFFERS THE WAY ON (QA-2026-09-29 round 2, R17 and R29).
 *
 * R29: the second click of a double click on Send stopped the run it had just
 * started, and the card said so with nothing to press -- the person retyped
 * the message. R17: a free model that gave up on its limit left a red card
 * saying to pick another model, and the button that had done it was gone.
 */
const thread = (extra: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <Thread
      prompt="Summarize the turns"
      onOpenPeerRun={() => undefined}
      earlierTurns={[]}
      events={[]}
      running={false}
      restoredMission={undefined}
      error={undefined}
      errorIsPersistence={false}
      startedAt={undefined}
      approvals={[]}
      onDecide={() => undefined}
      onAnswerQuestion={() => undefined}
      decidingIds={[]}
      cancelled={false}
      handoff={undefined}
      peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      {...extra}
    />
  )

describe('a run stopped before any tool ran', () => {
  it('offers Send again', () => {
    const html = thread({ cancelled: true, onSendAgain: () => undefined })
    expect(html).toContain('Stopped before it used any tools')
    expect(html).toContain('Send again')
  })

  it('does not, when a tool had run', () => {
    const html = thread({
      cancelled: true,
      onSendAgain: () => undefined,
      events: [
        { type: 'tool.started', payload: { callId: 'c1', name: 'Read', input: { file_path: 'a.txt' } } },
        { type: 'tool.completed', payload: { callId: 'c1', name: 'Read', output: 'hi' } }
      ]
    })
    expect(html).toContain('This run was stopped')
    expect(html).not.toContain('Stopped before it used any tools')
    expect(html).not.toContain('Send again')
  })

  it('does not, when the run was not stopped', () => {
    expect(thread({ onSendAgain: () => undefined })).not.toContain('Send again')
  })

  it('says nothing of undoing changes that were never made (0.496)', () => {
    const html = thread({ cancelled: true, onSendAgain: () => undefined })
    expect(html).not.toContain('undoing a change is yours to do')
    // A run that did something still says it.
    expect(thread({
      cancelled: true,
      events: [{ type: 'tool.started', payload: { callId: 'c1', name: 'Read', input: { file_path: 'a.txt' } } }]
    })).toContain('undoing a change is yours to do')
  })
})

describe('sent again (0.496)', () => {
  const stoppedEarly = { missionId: 'mission_a', prompt: 'Summarize the turns', events: [{ type: 'run.cancelled', payload: {} }] }
  const count = (html: string, text: string): number => html.split(text).length - 1

  it('draws the message once: the stopped copy gives way to the one sent again', () => {
    const html = thread({ earlierTurns: [stoppedEarly], events: [{ type: 'message.delta', payload: { text: 'Two turns.' } }] })
    expect(count(html, '>Summarize the turns<')).toBe(1)
  })

  it('and says no fresh session began when nothing before it is lost', () => {
    const html = thread({ earlierTurns: [stoppedEarly], coldStart: true })
    expect(html).not.toContain('A fresh session')
    // It still says so when a turn before it is on screen.
    const answered = { missionId: 'mission_b', prompt: 'Start here', events: [{ type: 'message.delta', payload: { text: 'Started.' } }] }
    expect(thread({ earlierTurns: [answered, stoppedEarly], coldStart: true })).toContain('A fresh session')
  })

  it('keeps a stopped turn that said something, or that was followed by other words', () => {
    const spoke = { ...stoppedEarly, events: [{ type: 'message.delta', payload: { text: 'Starting' } }, { type: 'run.cancelled', payload: {} }] }
    expect(count(thread({ earlierTurns: [spoke] }), '>Summarize the turns<')).toBe(2)
    expect(count(thread({ earlierTurns: [stoppedEarly], prompt: 'Something else' }), '>Summarize the turns<')).toBe(1)
    expect(thread({ earlierTurns: [stoppedEarly], prompt: 'Something else' })).toContain('>Something else<')
  })

  it('says a kept turn that was stopped before it replied was stopped, and only that one', () => {
    expect(thread({ earlierTurns: [stoppedEarly], prompt: 'Something else' })).toContain('Stopped before it replied')
    expect(thread({ earlierTurns: [stoppedEarly] })).not.toContain('Stopped before it replied')
    const spoke = { ...stoppedEarly, events: [{ type: 'message.delta', payload: { text: 'Starting' } }, { type: 'run.cancelled', payload: {} }] }
    expect(thread({ earlierTurns: [spoke], prompt: 'Something else' })).not.toContain('Stopped before it replied')
  })
})

describe('a run whose runtime is signed out (N11)', () => {
  it('offers that runtime\'s sign-in on the failure card', () => {
    const html = thread({
      error: 'Your access token could not be refreshed. Please log out and sign in again.',
      signInRuntime: 'codex'
    })
    expect(html).toContain('is signed out. Sign in again, then send your message.')
    expect(html).toContain('>Sign in</button>')
  })

  it('offers nothing of the kind otherwise', () => {
    expect(thread({ error: 'The model returned an unexpected response.' })).not.toContain('is signed out')
  })
})

describe('a free model that gave up on its limit', () => {
  const said =
    'timestamp=2026-09-29T03:40:47.596Z level=ERROR message="stream error" error.error="AI_APICallError: Rate limit exceeded"'

  it('is read as its limit from the runtime\'s last word', () => {
    expect(failedOnItsLimit({ process: { stderr: said } })).toBe(true)
    expect(failedOnItsLimit({ process: { stderr: 'Error: ENOENT: no such file' } })).toBe(false)
    expect(failedOnItsLimit({})).toBe(false)
  })

  it('offers the next model on the failure card', () => {
    const html = thread({
      error: 'OpenCode ended. The runtime reported that it is out of capacity right now.',
      limitModel: { label: 'Switch to Longcat 2.5 Preview Free', onPress: () => undefined }
    })
    expect(html).toContain('The run could not continue')
    expect(html).toContain('Switch to Longcat 2.5 Preview Free')
    expect(html).toContain('puts your message back in the chat box')
  })
})

describe('a run the provider dropped (0.511)', () => {
  // Colin's run, 2026-09-30: 56 minutes, then this, as the ledger recorded it.
  const said = 'Selected model is at capacity. Please try a different model.'

  it('offers Continue on the failure card, saying it was the provider', () => {
    const html = thread({ error: said, onContinueAfterBusy: () => undefined })
    expect(html).toContain('The run could not continue')
    expect(html).toContain("The model&#x27;s servers were busy: not your account, and nothing you did.")
    expect(html).toContain('Continue</button>')
  })

  it('offers nothing of the kind without it', () => {
    expect(thread({ error: said })).not.toContain('servers were busy')
  })
})
