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
