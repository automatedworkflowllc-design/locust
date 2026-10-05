import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'
import { afterEach, describe, expect, it } from 'vitest'

import { besideTheOthers } from './antigravity-beside.js'
import { createAntigravityHostProbe } from './antigravity-host.js'
import { listsItsModelsButListedNone } from './model-catalog.js'

/**
 * ANTIGRAVITY'S CHECK AT LAUNCH HOLDS NOTHING UP (Colin, 2026-10-05:
 * "antigravitys start up probe seemed like it took a pretty long time").
 *
 * Measured on his machine before this change: the check took 3.5-5.0 s, and
 * it was two CLI starts one after the other -- `agy --version` (0.3-1.3 s) and
 * then `agy models` (1.8-3.6 s, a fetch from Google). And it ran with a
 * sixty-second clock where every other probe has ten, inside a sweep that
 * waited for it (`Promise.all`), so one hung `agy` held another agent's row,
 * the first screen, and every Send that needed a sweep.
 */

type Answer = { stdout: string; stderr: string; code: number | null; timedOut?: boolean }

const MODELS = 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** An install folder with an `agy.exe` in the place the installer puts it. */
function withAgy(): string {
  const root = mkdtempSync(join(tmpdir(), 'locust-agy-'))
  folders.push(root)
  mkdirSync(join(root, 'agy', 'bin'), { recursive: true })
  writeFileSync(join(root, 'agy', 'bin', 'agy.exe'), '')
  return root
}

/** A runner the test finishes by hand, so it can say what had started and when. */
function handRunner() {
  const calls: { readonly args: readonly string[]; readonly timeoutMs: number | undefined; finish: (answer: Answer) => void }[] = []
  const run = (_exe: string, args: readonly string[], _env: Readonly<Record<string, string>>, timeoutMs?: number): Promise<Answer> =>
    new Promise((resolve) => {
      calls.push({ args, timeoutMs, finish: resolve })
    })
  return { run, calls }
}

const probeWith = (localAppData: string, run: ReturnType<typeof handRunner>['run'], cliCheckCapMs?: number) =>
  createAntigravityHostProbe({ platform: 'win32', localAppData, home: localAppData, run, ...(cliCheckCapMs === undefined ? {} : { cliCheckCapMs }) })

const record = (readiness: RuntimeDiscovery['readiness'], id = 'antigravity'): RuntimeDiscovery =>
  ({ id, kind: 'agent-runtime', displayName: id, optional: true, supportedFeatures: [], requiredFeatures: [], availability: 'available', readiness, diagnostics: [] }) as unknown as RuntimeDiscovery

describe("Antigravity's own check", () => {
  it('asks for the version and the model list at the same time, so it costs the slower one and not both', async () => {
    const { run, calls } = handRunner()
    const probe = probeWith(withAgy(), run)
    const asked = probe.discoveryRecord()
    await Promise.resolve()
    // Neither has finished, and both have started.
    expect(calls.map((call) => call.args[0]).sort()).toEqual(['--version', 'models'])
    calls.find((call) => call.args[0] === 'models')?.finish({ stdout: MODELS, stderr: '', code: 0 })
    calls.find((call) => call.args[0] === '--version')?.finish({ stdout: '1.2.17\n', stderr: '', code: 0 })
    const answer = await asked
    expect(answer.readiness).toBe('ready')
    expect(answer.version?.version).toBe('1.2.17')
  })

  it('stops waiting for a hung `agy` at its own clock, and says it did not answer rather than that the person is signed out', async () => {
    const { run, calls } = handRunner()
    const probe = probeWith(withAgy(), run, 40)
    const started = Date.now()
    const answer = await probe.discoveryRecord()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(answer.availability).toBe('available')
    expect(answer.readiness).toBe('unknown')
    expect(JSON.stringify(answer.diagnostics)).toMatch(/did not answer/)
    // And the runner was told the same clock, so the process itself is killed.
    expect(calls.map((call) => call.timeoutMs)).toEqual([40, 40])
  })

  it('still says signed out when `agy` answered and listed nothing', async () => {
    const { run, calls } = handRunner()
    const probe = probeWith(withAgy(), run)
    const asked = probe.discoveryRecord()
    await Promise.resolve()
    for (const call of calls) call.finish({ stdout: call.args[0] === '--version' ? '1.2.17\n' : 'Please sign in\n', stderr: '', code: 1 })
    expect((await asked).readiness).toBe('authentication-required')
  })

  it('treats a model list that was killed by its clock as no answer, not as signed out', async () => {
    const { run, calls } = handRunner()
    const probe = probeWith(withAgy(), run)
    const asked = probe.discoveryRecord()
    await Promise.resolve()
    for (const call of calls) call.finish(call.args[0] === 'models' ? { stdout: '', stderr: '', code: null, timedOut: true } : { stdout: '1.2.17\n', stderr: '', code: 0 })
    expect((await asked).readiness).toBe('unknown')
  })

  it('runs one check at a time: a second ask while one is going is given that one, and starts no second `agy`', async () => {
    const { run, calls } = handRunner()
    const probe = probeWith(withAgy(), run)
    const first = probe.discoveryRecord()
    const second = probe.discoveryRecord()
    await Promise.resolve()
    expect(calls).toHaveLength(2)
    for (const call of calls) call.finish({ stdout: call.args[0] === '--version' ? '1.2.17\n' : MODELS, stderr: '', code: 0 })
    expect(await second).toBe(await first)
    // Once it is over, the next ask is a new check.
    const third = probe.discoveryRecord()
    await Promise.resolve()
    expect(calls).toHaveLength(4)
    for (const call of calls.slice(2)) call.finish({ stdout: call.args[0] === '--version' ? '1.2.17\n' : MODELS, stderr: '', code: 0 })
    await third
  })

  it('has a pending answer that is installed and not answered, and claims nothing about signing in', () => {
    const { run } = handRunner()
    const pending = probeWith(withAgy(), run).pendingRecord()
    expect(pending.availability).toBe('available')
    expect(pending.readiness).toBe('unknown')
    expect(pending.executable?.commandName).toBe('agy')
    expect(JSON.stringify(pending.diagnostics)).not.toMatch(/sign/i)
  })
})

describe('the sweep and Antigravity', () => {
  const others = [record('ready', 'codex'), record('authentication-required', 'gemini')]

  it('goes on without a hung Antigravity: the others are exactly what they were, and Antigravity reads as not answered yet', async () => {
    const late: RuntimeDiscovery[] = []
    const pending = record('unknown')
    const started = Date.now()
    const swept = await besideTheOthers(Promise.resolve(others), new Promise<RuntimeDiscovery | undefined>(() => undefined), {
      pending: () => pending,
      late: (answer) => late.push(answer)
    })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(swept.others).toBe(others)
    expect(swept.antigravity).toBe(pending)
    expect(swept.leftBehind).toBe(true)
    expect(late).toEqual([])
  })

  it('does not slow the others down: their answer arrives when theirs does, whatever Antigravity is doing', async () => {
    let finishOthers: (value: readonly RuntimeDiscovery[]) => void = () => undefined
    let answerAntigravity: (value: RuntimeDiscovery) => void = () => undefined
    const swept = besideTheOthers(
      new Promise<readonly RuntimeDiscovery[]>((resolve) => { finishOthers = resolve }),
      new Promise<RuntimeDiscovery | undefined>((resolve) => { answerAntigravity = resolve }),
      { pending: () => record('unknown'), late: () => undefined }
    )
    let done = false
    void swept.then(() => { done = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)
    finishOthers(others)
    await swept
    expect(done).toBe(true)
    answerAntigravity(record('ready'))
  })

  it('hands over what Antigravity answers after the sweep has gone on, and only that', async () => {
    const late: RuntimeDiscovery[] = []
    let answerAntigravity: (value: RuntimeDiscovery) => void = () => undefined
    const swept = await besideTheOthers(Promise.resolve(others), new Promise<RuntimeDiscovery | undefined>((resolve) => { answerAntigravity = resolve }), {
      pending: () => record('unknown'),
      late: (answer) => late.push(answer)
    })
    expect(late).toEqual([])
    const real = record('ready')
    answerAntigravity(real)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(late).toEqual([real])
    expect(swept.others).toBe(others)
  })

  it('uses its answer when it was already in by the time the others were, and tells nobody later', async () => {
    const late: RuntimeDiscovery[] = []
    const real = record('ready')
    const swept = await besideTheOthers(new Promise<readonly RuntimeDiscovery[]>((resolve) => setTimeout(() => resolve(others), 20)), Promise.resolve(real), {
      pending: () => record('unknown'),
      late: (answer) => late.push(answer)
    })
    expect(swept.antigravity).toBe(real)
    expect(swept.leftBehind).toBe(false)
    expect(late).toEqual([])
  })
})

describe('the model list while Antigravity has not answered', () => {
  it('is not kept as the list: asked again, because it was built without Antigravity', () => {
    expect(listsItsModelsButListedNone([record('unknown')])).toBe(true)
    expect(listsItsModelsButListedNone([record('ready')])).toBe(false)
    expect(listsItsModelsButListedNone([record('authentication-required')])).toBe(false)
    // Not installed at all is an answer.
    expect(listsItsModelsButListedNone([{ ...record('unknown'), availability: 'unavailable' } as RuntimeDiscovery])).toBe(false)
  })
})
