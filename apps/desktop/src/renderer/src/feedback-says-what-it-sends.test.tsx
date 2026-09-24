import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { FeedbackDialog } from './components/FeedbackDialog.js'
import { conversationText } from './feedback.js'

/**
 * SEND FEEDBACK SAYS WHAT IT SENDS, AND WHERE.
 *
 * Colin, 2026-09-23: "for bug reporting we can use what claude code does" --
 * Claude Code's box: "Describe the issue", one line on what the report will
 * include, Cancel and Send. Locust has no service to send to, so the line
 * also says the report opens on GitHub, where the person sends it.
 */
describe('the box', () => {
  it("is Claude Code's: a title, one box, Cancel and Send -- Send off until something is written", () => {
    const html = renderToStaticMarkup(<FeedbackDialog onClose={() => undefined} />)
    expect(html).toContain('Send feedback')
    expect(html).toContain('placeholder="Describe the issue"')
    expect(html).toMatch(/<button type="button" class="lc-button">Cancel<\/button>/)
    expect(html).toMatch(/<button type="button" class="lc-primarybutton" disabled="">Send<\/button>/)
  })

  it('says what goes with it, and that the person sends it on GitHub', () => {
    const alone = renderToStaticMarkup(<FeedbackDialog onClose={() => undefined} />)
    expect(alone).toContain('This report will include your description and your Locust and Windows versions. It opens on GitHub, where you send it.')
    const withThread = renderToStaticMarkup(<FeedbackDialog conversation="You: hi" onClose={() => undefined} />)
    expect(withThread).toContain('your Locust and Windows versions, and this conversation. It opens on GitHub, where you send it.')
  })
})

describe('the conversation it carries', () => {
  const said = (itemId: string, text: string): NormalizedRuntimeEvent =>
    ({ type: 'message.delta', payload: { itemId, operation: 'append', text, final: true } }) as unknown as NormalizedRuntimeEvent

  it('is what was asked and what was said, and how a turn ended when it went wrong', () => {
    const text = conversationText(
      [
        { prompt: 'List the files', events: [said('a', 'Three files.'), { type: 'run.completed', payload: {} } as unknown as NormalizedRuntimeEvent] },
        { prompt: 'Count the lines', events: [{ type: 'run.failed', payload: { message: 'The runtime did not answer in time.' } } as unknown as NormalizedRuntimeEvent] }
      ],
      'Wren (Codex CLI, GPT-5.6 Luna)'
    )
    expect(text).toContain('You: List the files')
    expect(text).toContain('Wren (Codex CLI, GPT-5.6 Luna): Three files.')
    expect(text).toContain('You: Count the lines')
    expect(text).toContain('Wren (Codex CLI, GPT-5.6 Luna): (nothing said)')
    expect(text).toContain('(the turn failed: The runtime did not answer in time.)')
    expect(text).not.toContain('(the turn failed)\n\nYou: List')
  })
})
