import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// Colin: "Keep the queue beside its conversation in the profile"; the selector now lives in the durable controller.

/**
 * THE BOX UNDER A CONVERSATION SHOWS, EDITS AND SENDS ITS OWN QUEUE.
 *
 * The outside beta recheck of 0.299 (2026-09-23, P1): a line queued for Pip
 * showed under Gem's thread, and Edit there rewrote Pip's. The rules live in
 * steering.ts and are tested there (a-queued-message-stays-in-its-
 * conversation); this holds App to using them, because the defect was never
 * in a helper -- it was App handing the box the whole queue: its first row
 * to show, `setQueued([])` for Edit and Discard, and one fold for everyone.
 */
const app = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')
const queue = readFileSync(fileURLToPath(new URL('../renderer/src/conversationQueue.ts', import.meta.url)), 'utf8')

describe("the composer's queue", () => {
  it('is never emptied whole: Edit and Discard take one conversation out of it', () => {
    expect(app).not.toContain('setQueued([])')
    expect(app).toMatch(/onUnqueue=\{\(\) => setQueued\(\(rows\) => withoutQueueOf\(rows, queueKey\)\)\}/)
  })

  it('is never folded or shown whole: only the conversation the box queues into', () => {
    expect(app).not.toMatch(/combineQueued\(queued\)/)
    expect(app).toMatch(/queued=\{combineQueued\(waitingHere\)\[0\]\?\.text\}/)
    expect(app).toMatch(/queuedCount=\{waitingHere\.length\}/)
  })

  it('The composer sends only what was queued in the conversation on screen.', () => {
    expect(app).toMatch(/const front = queuedIn\(queued, shownKey\)\[0\]/)
    // Selection moved into the controller so its removal can be saved
    // before sending. Keep the App-to-controller conversation binding here;
    // the controller's tests exercise its behavior with two conversations.
    expect(app).toMatch(/void sendQueued\(shownKey, \(going\) => startMission/)
    expect(queue).toContain('const next = takeNext(before, key)')
  })
})

describe('the workroom header', () => {
  // It sits over the reply you are reading, and Colin asked for it, with the
  // sidebar, to be calmer than the face you talk to (0.279): the sidebar's
  // face says who just finished; the header does not hop as well.
  it('does not hop when its teammate finishes', () => {
    const header = app.slice(app.indexOf('<header className="lc-workroom__header">'), app.indexOf('</header>', app.indexOf('<header className="lc-workroom__header">')))
    expect(header).toContain('hopsWhenDone={false}')
  })
})
