import { describe, expect, it } from 'vitest'

/**
 * Starting a mission must not re-probe the runtimes it is not using.
 *
 * Fable's probing review, 2026-09-21, ranked first and measured: a Send 41 s
 * after launch waited **3 s** before the run could begin, because the start
 * path awaits a full sweep — every runtime's version, help, readiness and
 * model list — to answer one question about one of them. On Colin's machine
 * the slowest runtime *"ran past six seconds"*.
 *
 * The Stop button appears at 51 ms, so the screen says running for the whole
 * wait. That is why this is the most-felt delay in the product and nobody
 * ever named it.
 *
 * The rule under the fix: **the run itself is the real readiness check.** A
 * CLI signed out since the last sweep fails at launch, fast and legibly. So a
 * `ready` record is trusted for five minutes, and everything else — not
 * ready, not available, nothing cached — still takes the full sweep, because
 * that is the case where the answer may have changed in the person's favour.
 */

interface Record {
  readonly id: string
  readonly availability: string
  readonly readiness: string
  readonly executable?: string
}

/** The shape of `discoverForStart`, extracted so the rule can be tested. */
function makeDiscoverForStart(
  cache: () => { readonly at: number; readonly value: readonly Record[] } | undefined,
  sweep: () => Promise<readonly Record[]>,
  now: () => number,
  ttl = 5 * 60_000
) {
  return (runtimeId?: string): Promise<readonly Record[]> => {
    const held = cache()
    if (runtimeId !== undefined && held !== undefined && now() - held.at < ttl) {
      const chosen = held.value.find((entry) => entry.id === runtimeId)
      if (
        chosen !== undefined
        && chosen.availability === 'available'
        && chosen.readiness === 'ready'
        && chosen.executable !== undefined
      ) {
        return Promise.resolve(held.value)
      }
    }
    return sweep()
  }
}

const ready = (id: string): Record => ({ id, availability: 'available', readiness: 'ready', executable: `${id}.exe` })

describe('starting one mission probes one runtime', () => {
  it('does not sweep when the runtime was ready a minute ago', async () => {
    let sweeps = 0
    const at = 1_000_000
    const discover = makeDiscoverForStart(
      () => ({ at, value: [ready('codex'), ready('opencode')] }),
      async () => { sweeps += 1; return [] },
      () => at + 60_000
    )
    const result = await discover('opencode')
    expect(sweeps).toBe(0)
    expect(result.map((entry) => entry.id)).toContain('opencode')
  })

  it('sweeps when the record has gone stale', async () => {
    let sweeps = 0
    const at = 1_000_000
    const discover = makeDiscoverForStart(
      () => ({ at, value: [ready('opencode')] }),
      async () => { sweeps += 1; return [ready('opencode')] },
      () => at + 6 * 60_000
    )
    await discover('opencode')
    expect(sweeps).toBe(1)
  })

  it('sweeps when the runtime was NOT ready, because that is the answer that may have changed', async () => {
    // Someone signing in at a terminal is the whole reason re-probing exists.
    let sweeps = 0
    const at = 1_000_000
    const discover = makeDiscoverForStart(
      () => ({ at, value: [{ id: 'codex', availability: 'available', readiness: 'authentication-required' }] }),
      async () => { sweeps += 1; return [ready('codex')] },
      () => at + 1_000
    )
    await discover('codex')
    expect(sweeps).toBe(1)
  })

  it('sweeps when there is no record at all', async () => {
    let sweeps = 0
    const discover = makeDiscoverForStart(() => undefined, async () => { sweeps += 1; return [] }, () => 0)
    await discover('codex')
    expect(sweeps).toBe(1)
  })

  it('sweeps when nobody named a runtime', async () => {
    // The old behaviour, kept for every caller that wants the whole picture.
    let sweeps = 0
    const at = 1_000_000
    const discover = makeDiscoverForStart(() => ({ at, value: [ready('codex')] }), async () => { sweeps += 1; return [] }, () => at)
    await discover()
    expect(sweeps).toBe(1)
  })
})
