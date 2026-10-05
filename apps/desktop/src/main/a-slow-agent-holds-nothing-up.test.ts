import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { FIRST_SCREEN_DEADLINE_MS, keepWhatWasAnswered, settleWithin, type SweepCheck } from './sweep-settle.js'
import { listsItsModelsButListedNone } from './model-catalog.js'
import { createOutstandingChecks } from './outstanding-checks.js'
import { createRuntimeDiscoveryService, publicStatus as publicStatusOf } from './runtime-discovery.js'

/**
 * NO SINGLE AGENT'S CHECK HOLDS THE FIRST SCREEN (2026-10-05).
 *
 * Measured on the 0.627 package, three launches: OpenCode's check took 5.3 s,
 * 3.2 s and 11.5 s, and the sweep -- which the first screen waits for -- was
 * released at 6.2, 3.9 and 12.5 s: always the slowest agent's time, and the
 * slowest agent was a different one each launch. Antigravity's check had
 * already been taken out of the wait (0.628); this is the rule for all of them.
 */

const record = (id: string, readiness: RuntimeDiscovery['readiness'], extra: Partial<RuntimeDiscovery> = {}): RuntimeDiscovery =>
  ({ id, kind: 'agent-runtime', displayName: id, optional: true, supportedFeatures: [], requiredFeatures: [], availability: 'available', readiness, diagnostics: [], ...extra }) as unknown as RuntimeDiscovery

const pendingRecord = (id: string): RuntimeDiscovery =>
  record(id, 'unknown', { diagnostics: [{ code: 'check-pending', severity: 'info', message: `${id} is being checked` }] as never })

/** A check the test answers by hand. */
function handCheck(id: string, located: Promise<void> = Promise.resolve()) {
  let answer: (value: RuntimeDiscovery | undefined) => void = () => undefined
  let fail: (reason: unknown) => void = () => undefined
  const result = new Promise<RuntimeDiscovery | undefined>((resolve, reject) => {
    answer = resolve
    fail = reject
  })
  const check: SweepCheck = { id, result, located, pending: () => pendingRecord(id) }
  return { check, answer, fail }
}

const instant = (id: string, readiness: RuntimeDiscovery['readiness'] = 'ready'): { check: SweepCheck; value: RuntimeDiscovery } => {
  const value = record(id, readiness)
  return { check: { id, result: Promise.resolve(value), located: Promise.resolve(), pending: () => pendingRecord(id) }, value }
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the sweep and a slow agent', () => {
  it('has a first-screen deadline that is the fast agents\' time, not the slowest tool on the machine', () => {
    expect(FIRST_SCREEN_DEADLINE_MS).toBeGreaterThanOrEqual(1_500)
    expect(FIRST_SCREEN_DEADLINE_MS).toBeLessThanOrEqual(4_000)
  })

  it('is released the moment every agent has answered, not at the deadline', async () => {
    const claude = instant('claude')
    const codex = instant('codex')
    const started = Date.now()
    const settled = await settleWithin([claude.check, codex.check], { deadlineMs: 5_000, late: () => undefined })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(settled.answers).toEqual([claude.value, codex.value])
    expect(settled.left.size).toBe(0)
  })

  it('goes on without a slow agent at the deadline: the others are exactly what they were, and the slow one is shown as being checked', async () => {
    const claude = instant('claude')
    const codex = instant('codex', 'authentication-required')
    const opencode = handCheck('opencode')
    const started = Date.now()
    const settled = await settleWithin([claude.check, opencode.check, codex.check], { deadlineMs: 40, late: () => undefined })
    const waited = Date.now() - started
    // Released by the deadline, however long OpenCode takes: it has not answered at all.
    expect(waited).toBeGreaterThanOrEqual(30)
    expect(waited).toBeLessThan(1_000)
    // The answers that were in are the same objects, in the order the checks were given.
    expect(settled.answers[0]).toBe(claude.value)
    expect(settled.answers[2]).toBe(codex.value)
    expect(settled.answers[1]).toEqual(pendingRecord('opencode'))
    expect([...settled.left.keys()]).toEqual(['opencode'])
    opencode.answer(record('opencode', 'ready'))
  })

  it('does not let one slow agent delay another: a second slow agent is shown the same way, and a fast one is never held', async () => {
    const claude = instant('claude')
    const settled = await settleWithin([handCheck('cursor').check, claude.check, handCheck('opencode').check], { deadlineMs: 30, late: () => undefined })
    expect(settled.answers.map((entry) => entry.id)).toEqual(['cursor', 'claude', 'opencode'])
    expect(settled.answers[1]).toBe(claude.value)
    expect([...settled.left.keys()].sort()).toEqual(['cursor', 'opencode'])
  })

  it('hands over a late answer once, when it lands -- and uses nothing but that agent\'s own answer', async () => {
    const heard: { id: string; answer: RuntimeDiscovery | undefined }[] = []
    const opencode = handCheck('opencode')
    const settled = await settleWithin([instant('claude').check, opencode.check], { deadlineMs: 20, late: (id, answer) => heard.push({ id, answer }) })
    expect(heard).toEqual([])
    const real = record('opencode', 'ready')
    opencode.answer(real)
    await tick(5)
    expect(heard).toEqual([{ id: 'opencode', answer: real }])
    await tick(30)
    // Once, however long the sweep's own answer is held.
    expect(heard).toHaveLength(1)
    expect(await settled.left.get('opencode')).toBe(real)
  })

  it('tells nobody later about an agent that answered in time', async () => {
    const heard: string[] = []
    const claude = handCheck('claude')
    const waiting = settleWithin([claude.check], { deadlineMs: 500, late: (id) => heard.push(id) })
    claude.answer(record('claude', 'ready'))
    await waiting
    await tick(20)
    expect(heard).toEqual([])
  })

  it('reads a hung agent as not answered -- not signed out, not missing -- and a failed one is reported without losing the rest', async () => {
    const hung = handCheck('muse')
    const failing = handCheck('cursor')
    const heard: { id: string; answer: RuntimeDiscovery | undefined }[] = []
    const settled = await settleWithin([instant('codex').check, hung.check, failing.check], { deadlineMs: 20, late: (id, answer) => heard.push({ id, answer }) })
    const shown = publicStatusOf(settled.answers[1]!)
    expect(shown).toMatchObject({ id: 'muse', installed: true, status: 'probe-failed', auth: 'unknown', ready: false, checking: true })
    expect(settled.answers[2]).toEqual(pendingRecord('cursor'))
    failing.fail(new Error('the runner fell over'))
    await tick(5)
    expect(heard).toEqual([{ id: 'cursor', answer: undefined }])
    // The hung one never answers: it stays "checking", and is never reported as anything else.
    expect(heard.some((entry) => entry.id === 'muse')).toBe(false)
  })

  it('leaves an agent that has no answer to give out of the sweep, as the sweep always did', async () => {
    const none = handCheck('antigravity')
    none.answer(undefined)
    const claude = instant('claude')
    const settled = await settleWithin([none.check, claude.check], { deadlineMs: 50, late: () => undefined })
    expect(settled.answers).toEqual([claude.value])
  })

  it('learns whether a slow agent is installed before showing it, and only waits for that lookup', async () => {
    let found: () => void = () => undefined
    const looked = new Promise<void>((resolve) => { found = resolve })
    const slow = handCheck('opencode', looked)
    let shownAt = 0
    const check: SweepCheck = { ...slow.check, pending: () => { shownAt = Date.now(); return pendingRecord('opencode') } }
    const waiting = settleWithin([check], { deadlineMs: 10, late: () => undefined })
    await tick(60)
    // Past the deadline, still waiting for the PATH search alone.
    expect(shownAt).toBe(0)
    found()
    const settled = await waiting
    expect(shownAt).toBeGreaterThan(0)
    expect(settled.answers).toEqual([pendingRecord('opencode')])
  })
})

describe('what is built while an agent is still being checked', () => {
  it('is not kept as the model list: asked again once the agent has answered, because the list was built without it', () => {
    expect(listsItsModelsButListedNone([pendingRecord('opencode')])).toBe(true)
    expect(listsItsModelsButListedNone([pendingRecord('cursor'), record('claude', 'ready', { modelHints: { aliases: ['opus'], efforts: [], models: [] } })])).toBe(true)
    expect(listsItsModelsButListedNone([record('copilot', 'ready')])).toBe(false)
    // Not installed is an answer, and so is signed out.
    expect(listsItsModelsButListedNone([{ ...pendingRecord('opencode'), availability: 'unavailable' } as RuntimeDiscovery])).toBe(false)
  })
})

describe('a start while an agent is still being checked', () => {
  const sweep = [record('claude', 'ready'), pendingRecord('opencode')]

  it('on that agent waits for that agent own check, and uses its answer', async () => {
    const held = createOutstandingChecks()
    const opencode = handCheck('opencode')
    held.set(opencode.check)
    let seen: readonly RuntimeDiscovery[] | undefined
    const start = held.forStart('opencode', sweep).then((found) => { seen = found })
    await tick(20)
    expect(seen).toBeUndefined()
    const real = record('opencode', 'ready')
    opencode.answer(real)
    await start
    expect(seen).toEqual([sweep[0], real])
  })

  it('on any other agent, or on none, never waits for it', async () => {
    const held = createOutstandingChecks()
    held.set(handCheck('opencode').check)
    const started = Date.now()
    expect(await held.forStart('claude', sweep)).toBe(sweep)
    expect(await held.forStart(undefined, sweep)).toBe(sweep)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('keeps what it had when that agent check ends without an answer', async () => {
    const held = createOutstandingChecks()
    const failing = handCheck('opencode')
    held.set(failing.check)
    const start = held.forStart('opencode', sweep)
    failing.fail(new Error('gone'))
    expect(await start).toBe(sweep)
  })
})

describe('the window\'s answer while an agent answers late', () => {
  const checkingOpenCode = (): RuntimeDiscovery => pendingRecord('opencode')

  it('is rebuilt when a late answer lands in the middle of building it, and is not kept as the stale list', async () => {
    const held: RuntimeDiscovery[] = [record('claude', 'ready'), checkingOpenCode()]
    let releaseNpm: (present: boolean) => void = () => undefined
    const service = createRuntimeDiscoveryService({
      probe: async () => [...held],
      // The npm question takes a while, as it can on a loaded machine.
      npmPresent: () => new Promise<boolean>((resolve) => { releaseNpm = resolve })
    })
    const asked = service.get()
    await tick(5)
    // OpenCode answers while the answer is still being built, and the host says so.
    held[1] = record('opencode', 'ready')
    service.invalidate()
    releaseNpm(true)
    const response = await asked
    expect(response.ok && response.data.runtimes.find((entry) => entry.id === 'opencode')).toMatchObject({ status: 'ready', ready: true })
    expect(response.ok && response.data.runtimes.find((entry) => entry.id === 'opencode')).not.toHaveProperty('checking')
  })

  it('is not served from a cache that was built before the late answer', async () => {
    const held: RuntimeDiscovery[] = [checkingOpenCode()]
    let releaseNpm: (present: boolean) => void = () => undefined
    let calls = 0
    const service = createRuntimeDiscoveryService({
      probe: async () => [...held],
      npmPresent: () => { calls += 1; return calls === 1 ? new Promise<boolean>((resolve) => { releaseNpm = resolve }) : Promise.resolve(true) }
    })
    const first = service.get()
    await tick(5)
    held[0] = record('opencode', 'ready')
    service.invalidate()
    releaseNpm(true)
    await first
    // The next ask must not get the answer the first one began with.
    const next = await service.get()
    expect(next.ok && next.data.runtimes[0]).toMatchObject({ status: 'ready' })
  })
})

describe('a later sweep that goes on without an agent which answered before', () => {
  const answeredReady = record('cursor', 'ready', { modelHints: { aliases: [], efforts: [], models: [{ id: 'auto', displayName: 'Auto' }] } as never })

  it('keeps the last definite answer of that agent, so the picker does not lose its models while the new check runs', async () => {
    const settled = await settleWithin([instant('claude').check, handCheck('cursor').check], { deadlineMs: 20, late: () => undefined })
    const shown = keepWhatWasAnswered(settled, [answeredReady, record('claude', 'ready')])
    expect(shown[1]).toBe(answeredReady)
    // The agents that answered are the own answers of this sweep, not the last one.
    expect(shown[0]).toBe(settled.answers[0])
  })

  it('keeps a signed-out answer too -- but never a guess: no definite answer before, or only a placeholder, is shown as being checked', async () => {
    const settled = await settleWithin([handCheck('cursor').check, handCheck('opencode').check, handCheck('gemini').check], { deadlineMs: 20, late: () => undefined })
    const signedOut = record('cursor', 'authentication-required')
    const shown = keepWhatWasAnswered(settled, [signedOut, pendingRecord('opencode'), record('gemini', 'unhealthy')])
    expect(shown[0]).toBe(signedOut)
    expect(shown[1]).toEqual(pendingRecord('opencode'))
    expect(shown[2]).toEqual(pendingRecord('gemini'))
  })

  it('does not make a start wait for an agent that is shown from its last answer', async () => {
    const held = createOutstandingChecks()
    held.set(handCheck('cursor').check)
    const started = Date.now()
    const found = [answeredReady]
    expect(await held.forStart('cursor', found)).toBe(found)
    expect(Date.now() - started).toBeLessThan(500)
  })
})
