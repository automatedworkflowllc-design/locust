import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * The thread when a teammate hands a file over.
 *
 * Colin, 2026-09-19, with the screenshot: he asked Yurt to "send me an md of
 * your report" and the reply named a path in a sentence. The file existed.
 * There was simply nothing in the thread that was the file.
 *
 * Two things have to be true at once for that to be fixed, and each was a
 * separate shipped defect in the four blocks that came before this one: the
 * button appears, AND the raw tags never reach the bubble. A block left in
 * the prose is the app showing a person its own protocol, which is what the
 * room card did with a task block in the first live room run (2026-09-05).
 */

const at = '2026-09-19T10:00:00.000Z'
const said = (text: string, final = true, itemId = 'msg1'): NormalizedRuntimeEvent =>
  ({
    id: `e-${itemId}-${String(final)}`,
    runId: 'r',
    missionId: 'm',
    sequence: 1,
    occurredAt: at,
    sourceAdapter: 'opencode',
    type: 'message.delta',
    payload: { itemId, operation: 'replace', text, final }
  }) as unknown as NormalizedRuntimeEvent

const thread = (events: readonly NormalizedRuntimeEvent[], running = false) =>
  buildThread(events, { running, mayEdit: true, startedAt: at })

const REPLY = 'Here is the rollup.\n\n<locust-file>\ndocs/report.md :: the rollup you asked for\n</locust-file>'

describe('a reply that hands over a file', () => {
  it('draws the file as its own item, with the path and the note', () => {
    const files = thread([said(REPLY)]).find((item) => item.type === 'files')
    expect(files).toBeDefined()
    expect(JSON.stringify(files)).toContain('docs/report.md')
    expect(JSON.stringify(files)).toContain('the rollup you asked for')
  })

  it('shows the person the answer and not the protocol', () => {
    const message = thread([said(REPLY)]).find((item) => item.type === 'agent-message')
    expect(message).toBeDefined()
    const text = (message as { readonly text: string }).text
    expect(text).toBe('Here is the rollup.')
    expect(text).not.toContain('locust-file')
  })

  it('still draws the file when the block was the whole reply', () => {
    // "Here you go" often lives in the note rather than in prose, and an
    // empty message item is dropped -- so the files item has to stand on its
    // own or this reply hands over nothing at all.
    const items = thread([said('<locust-file>\ndocs/report.md\n</locust-file>')])
    expect(items.some((item) => item.type === 'files')).toBe(true)
    expect(items.some((item) => item.type === 'agent-message')).toBe(false)
  })

  it('waits for the message to finish before drawing a button', () => {
    // Half a block is not a file. A button that appears mid-stream and then
    // moves or vanishes is worse than one that arrives a second late.
    const items = thread([said(REPLY, false)], true)
    expect(items.some((item) => item.type === 'files')).toBe(false)
  })

  it('leaves an ordinary reply with no file item', () => {
    const items = thread([said('I wrote docs/report.md for you.')])
    expect(items.some((item) => item.type === 'files')).toBe(false)
  })
})
