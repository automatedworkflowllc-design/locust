import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentText } from './components/ThreadItems.js'

/**
 * A gap the RUNTIME left is said in the app's voice, not the teammate's.
 *
 * Colin, 2026-09-21, on a reply from Antigravity: *"minor truncation bug"* —
 * a screenshot showing `<truncated 259 bytes>` in the middle of a sentence,
 * splitting a word: "...point runtime adapters directly at internal Ollama i"
 * / the marker / "yte-offset, tamper-evident receipts of every tool call".
 *
 * MEASURED IN HIS OWN LEDGER before changing anything: the marker is
 * Antigravity's, not ours — 7 `message.delta` texts and 48 `tool.completed`
 * outputs carry it, and no code in this repo writes that string. The runtime
 * drops part of its own record and says so.
 *
 * So it is true, and hiding it would hand someone a broken sentence as a
 * whole one. What was wrong is that a machine string was drawn as prose the
 * teammate had written. The text is untouched — `segmentsCoverInput` still
 * holds — only the drawing changes.
 */

const drawn = (text: string): string => renderToStaticMarkup(<AgentText text={text} streaming={false} />)

describe('a runtime gap is not the teammate', () => {
  it('draws the marker as a note', () => {
    const html = drawn('before the gap\n\n<truncated 259 bytes>\n\nafter the gap')
    expect(html).toContain('lc-gap')
    expect(html).toContain('259 bytes the runtime did not keep')
    // The machine string itself stops being shown as the reply.
    expect(html).not.toContain('&lt;truncated 259 bytes&gt;')
  })

  it('keeps every other word of the reply', () => {
    // The rule this file lives under: nothing the model wrote is dropped.
    const html = drawn('before the gap\n\n<truncated 259 bytes>\n\nafter the gap')
    expect(html).toContain('before the gap')
    expect(html).toContain('after the gap')
  })

  it('leaves a sentence that merely mentions truncation alone', () => {
    // Only a paragraph that is ENTIRELY the marker. A teammate explaining
    // truncation is writing prose, and prose is what this must not eat.
    const said = 'The log said <truncated 259 bytes> which is why the tail is missing.'
    const html = drawn(said)
    expect(html).not.toContain('lc-gap')
    expect(html).toContain('which is why the tail is missing')
  })
})
