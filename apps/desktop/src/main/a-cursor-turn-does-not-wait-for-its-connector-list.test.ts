import { afterEach, describe, expect, it } from 'vitest'

import { cursorReadyConnectors, forgetCursorConnectorReading, warmCursorConnectors } from './cursor-connector-notice.js'

/**
 * A CURSOR TURN DOES NOT WAIT FOR ITS CONNECTOR LIST (0.692).
 *
 * `cursor-agent mcp list` takes 3-4 s (measured 2026-10-07). A reading older
 * than five minutes made the next Cursor turn read it again before starting,
 * and turns are rarely five minutes apart: Cursor's briefing was a median 5.1 s
 * of Colin's starts, every other agent's 0.2-0.5 s. An old reading now answers
 * at once while a new one is read behind it, and Locust reads it when Cursor is
 * found, so even the first turn does not wait.
 */
afterEach(() => forgetCursorConnectorReading())

const LISTING = (name: string): string => `${name}: ready\n`

/** A listing that answers only when told to, counting how often it was asked. */
function slowLister(names: string[]) {
  let calls = 0
  const pending: ((text: string) => void)[] = []
  const lister = (): Promise<string | undefined> => {
    calls += 1
    return new Promise((resolve) => { pending.push((text) => resolve(text)) })
  }
  return {
    lister,
    calls: () => calls,
    answer: async () => {
      const next = pending.shift()
      next?.(LISTING(names.shift() ?? 'none'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

describe("a Cursor turn and its connector list", () => {
  it('answers from an old reading at once, and reads a new one behind it', async () => {
    const slow = slowLister(['notion', 'notion-and-linear'])
    let clock = 0
    const now = (): number => clock
    const first = cursorReadyConnectors(slow.lister, now)
    await slow.answer()
    expect(await first).toMatch(/notion/)
    // Ten minutes later the reading is old: the turn still gets an answer without waiting.
    clock = 10 * 60_000
    let settled = false
    const second = cursorReadyConnectors(slow.lister, now).then((line) => { settled = true; return line })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
    expect(await second).toMatch(/notion/)
    expect(slow.calls()).toBe(2)
    // The new reading lands, and the next turn has it.
    await slow.answer()
    expect(await cursorReadyConnectors(slow.lister, now)).toMatch(/notion-and-linear/)
    expect(slow.calls()).toBe(2)
  })

  it('reads once, however many turns ask while it is reading', async () => {
    const slow = slowLister(['notion'])
    const asks = [cursorReadyConnectors(slow.lister, () => 0), cursorReadyConnectors(slow.lister, () => 0)]
    await slow.answer()
    await Promise.all(asks)
    expect(slow.calls()).toBe(1)
  })

  it('is read when Cursor is found, so the first turn finds it read', async () => {
    const slow = slowLister(['notion'])
    warmCursorConnectors(slow.lister, () => 0)
    warmCursorConnectors(slow.lister, () => 0)
    expect(slow.calls()).toBe(1)
    await slow.answer()
    let settled = false
    const first = cursorReadyConnectors(slow.lister, () => 1).then((line) => { settled = true; return line })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
    expect(await first).toMatch(/notion/)
    expect(slow.calls()).toBe(1)
  })
})
