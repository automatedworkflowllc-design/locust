import { describe, expect, it } from 'vitest'

import { cappedLiveEvents, LIVE_EVENT_CAP, runtimeNeverStarted } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * "Run it again" is offered only where there is nothing to repeat.
 *
 * Colin, 2026-09-14: a Cursor run died instantly on `EPERM: operation not
 * permitted, rename '...\.cursor\cli-config.json.<pid>.<uuid>.tmp'`.
 * `cursor-agent` rewrites its own config on startup and on Windows that
 * rename fails while a second copy of it holds the file open. The mission
 * ledger held exactly two records: `mission.created` and `run.failed`.
 * Nothing opened, nothing ran, nothing touched. His only way forward was to
 * retype the message, which was still exactly right.
 *
 * The safe version of a retry is not "retry when it looks transient" -- that
 * is a guess about a system this app cannot see. It is: **offer it only when
 * the runtime never started**, because then pressing it cannot repeat
 * anything, and that is checkable rather than inferred.
 *
 * The exclusion is the load-bearing half. A run that started and then failed
 * may have edited files, spent tokens or half-finished a tool call. Whether
 * that matters is the person's call and the app does not get to make it for
 * them, so no button is offered there at all.
 *
 * Deliberately NOT an automatic retry. Auto-retry would put this decision in
 * the start path of every run, and nobody has yet established how often this
 * failure even happens -- one occurrence in 89 missions in the only ledger
 * that exists. A control that cannot be measured should not be automatic.
 */

const event = (type: string): NormalizedRuntimeEvent =>
  ({
    id: 'e',
    runId: 'r',
    missionId: 'm',
    sequence: 1,
    occurredAt: '2026-09-14T06:42:00.000Z',
    sourceAdapter: 'cursor',
    type,
    payload: {}
  }) as unknown as NormalizedRuntimeEvent

describe('whether a failed run may simply be run again', () => {
  it('says yes when the runtime never started', () => {
    // The measured shape: the failure and nothing else.
    expect(runtimeNeverStarted([event('run.failed')])).toBe(true)
    expect(runtimeNeverStarted([])).toBe(true)
  })

  it('says no the moment the runtime started, however early it then failed', () => {
    // This is the whole safety property. A started run may have done
    // something, and re-running it would do that thing twice.
    expect(runtimeNeverStarted([event('run.started'), event('run.failed')])).toBe(false)
  })

  it('says no for a run that reached a tool', () => {
    expect(runtimeNeverStarted([event('run.started'), event('tool.started'), event('run.failed')])).toBe(false)
  })

  /*
   * H4 (the code review): the rule is the other way round now. Anything the
   * runtime said -- even an event this build does not know -- is a sign it
   * was running, and so of work that may be repeated. Only the failure and
   * the host's own diagnostics mean it never started.
   */
  it('takes any event from the runtime, even one it does not know, as a start', () => {
    expect(runtimeNeverStarted([event('runtime.unknown_event'), event('run.failed')])).toBe(false)
  })

  it('H4: a run that reached a tool without ever saying run.started DID start (OpenCode, Muse, Antigravity)', () => {
    expect(runtimeNeverStarted([event('step.started'), event('message.delta'), event('tool.started'), event('tool.completed'), event('run.failed')])).toBe(false)
    expect(runtimeNeverStarted([event('message.delta'), event('run.failed')])).toBe(false)
  })

  it('is still true for a run that never reached its runtime: its failure and the host’s notes', () => {
    expect(runtimeNeverStarted([event('adapter.diagnostic'), event('run.failed')])).toBe(true)
    expect(runtimeNeverStarted([event('run.failed')])).toBe(true)
  })

  it('counts a runtime thread on any event as a start', () => {
    expect(runtimeNeverStarted([{ ...event('run.failed'), runtimeThreadId: 'thread_1' } as never])).toBe(false)
  })
})

describe('a long live run', () => {
  it('H4: keeps its first event past the cap, so a failed turn still reads as started', () => {
    const long = [event('run.started'), ...Array.from({ length: 700 }, () => event('message.delta')), event('run.failed')]
    const kept = cappedLiveEvents(long)
    expect(kept).toHaveLength(LIVE_EVENT_CAP)
    expect(kept[0]).toBe(long[0])
    expect(kept.at(-1)).toBe(long.at(-1))
    expect(cappedLiveEvents(long.slice(0, 10))).toEqual(long.slice(0, 10))
  })
})
