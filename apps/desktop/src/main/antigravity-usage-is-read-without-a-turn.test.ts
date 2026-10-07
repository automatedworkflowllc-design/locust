import { describe, expect, it, vi } from 'vitest'
import type { AppServerRunProcess, RuntimeDiscovery } from '@teammate/runtime-adapters'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: exec }))
import { antigravityUsageText, readAntigravityUsage } from './antigravity-usage.js'
import { createModelCatalog } from './model-catalog.js'

const reset = '2099-10-10T20:49:36Z'
const bucket = (window: string, remaining_fraction: number) => ({ window, remaining_fraction, reset_time: reset })
const answer = (other = 0.2) => ({ status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [bucket('weekly', 0.67), bucket('5h', 0.95)] },
  { name: 'Claude and GPT models', buckets: [bucket('weekly', other), bucket('5h', 1)] }
] } } })
const executable = { commandName: 'agy', discoveredPath: '/tools/agy', executablePath: '/tools/agy', prefixArgs: [], kind: 'native' as const, env: { AGY_TEST: 'yes' } }
const runtime: RuntimeDiscovery = { id: 'antigravity', kind: 'agent-runtime', displayName: 'Antigravity', optional: true,
  availability: 'available', readiness: 'ready', executable, supportedFeatures: [], requiredFeatures: [], diagnostics: [],
  modelHints: { models: [{ id: 'gemini-flash', displayName: 'Gemini Flash' }], aliases: [], efforts: [] } }

function codexServer(refuseModels = false) {
  let onData = (_chunk: string): void => undefined
  const asked: string[] = []
  const process: AppServerRunProcess = {
    write: (line) => {
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.id === undefined) return
      asked.push(message.method ?? '')
      const result = message.method === 'model/list' ? { data: [{ id: 'gpt-test' }] }
        : message.method === 'account/rateLimits/read' ? { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } } : {}
      const response = refuseModels && message.method === 'model/list'
        ? { id: message.id, error: { code: -32601, message: 'unavailable' } } : { id: message.id, result }
      queueMicrotask(() => onData(`${JSON.stringify({ jsonrpc: '2.0', ...response })}\n`))
    },
    kill: vi.fn(), onData: (callback) => { onData = callback }, onExit: () => undefined
  }
  return { process, asked }
}

describe('Antigravity reports remaining plan windows without a turn', () => {
  it('puts the short window first and includes the lower Claude and GPT limit', () => {
    expect(antigravityUsageText(answer())).toBe('Gemini: 5-hour window 95% left · resets 2099-10-10T20:49:36.000Z · Gemini: weekly window 67% left · resets 2099-10-10T20:49:36.000Z · Claude and GPT: 5-hour window 100% left · Claude and GPT: weekly window 20% left · resets 2099-10-10T20:49:36.000Z')
  })
  it('omits the other group when it is not lower', () => {
    expect(antigravityUsageText(answer(0.9))).not.toContain('Claude and GPT')
  })
  it('does not call a full bucket a future reset, even without a description', () => {
    const full = answer(1)
    full.command.data.groups[0]!.buckets = [bucket('weekly', 1), bucket('5h', 1)]
    expect(antigravityUsageText(full)).toBe('Gemini: 5-hour window 100% left · Gemini: weekly window 100% left')
    full.command.data.groups[0]!.buckets[0]!.reset_time = '2099-10-17T20:49:36Z'
    expect(antigravityUsageText(full)).not.toContain('resets')
  })
  it.each([undefined, {}, { status: 'ERROR' }, { ...answer(), num_turns: 1 },
    { ...answer(), command: { name: 'credits', data: answer().command.data } },
    { ...answer(), command: { name: 'usage', data: { groups: [null] } } }
  ])('ignores a malformed answer or refusal (%j)', (value) => {
    expect(antigravityUsageText(value)).toBeUndefined()
  })
  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.5'])('rejects invalid fractions (%s)', (fraction) => {
    const value = answer()
    Object.assign(value.command.data.groups[0]!.buckets[0]!, { remaining_fraction: fraction })
    expect(antigravityUsageText(value)).toBeUndefined()
  })
  it('does not invent a reset when its date cannot be read', () => {
    const value = answer()
    value.command.data.groups[0]!.buckets[0]!.reset_time = 'unknown'
    expect(antigravityUsageText(value)).toContain('Gemini: weekly window 67% left · Claude')
  })
  it('rejects missing windows, unknown groups and duplicate buckets', () => {
    const missing = answer()
    missing.command.data.groups[0]!.buckets.pop()
    expect(antigravityUsageText(missing)).toBeUndefined()
    const unknown = answer()
    unknown.command.data.groups[0]!.name = 'Unexpected'
    expect(antigravityUsageText(unknown)).toBeUndefined()
    const duplicate = answer()
    duplicate.command.data.groups[0]!.buckets.push(bucket('weekly', 0.4))
    expect(antigravityUsageText(duplicate)).toBeUndefined()
  })
  it('uses only the discovered executable and usage argv, with no shell and a bounded hidden process', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(answer())))
    expect(await readAntigravityUsage({ ...executable, prefixArgs: ['prefix'] })).toEqual(answer())
    expect(exec).toHaveBeenLastCalledWith('/tools/agy', ['prefix', '-p', '/usage', '--output-format', 'json'],
      expect.objectContaining({ windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 256 * 1024, env: expect.objectContaining({ AGY_TEST: 'yes' }) }), expect.any(Function))
  })
  it.each([['refused', ''], [null, 'not json']])('fails softly on a refused or unreadable CLI response', async (error, stdout) => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(error, stdout))
    expect(await readAntigravityUsage(executable)).toBeUndefined()
  })
  it('keeps the reading and models even when Codex is absent, and caches the read', async () => {
    exec.mockClear()
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(answer())))
    const spawn = vi.fn()
    const catalog = createModelCatalog({ discover: async () => [runtime], spawn })
    const result = await catalog.read()
    expect(result.ok && result.data.usageWindows?.antigravity).toMatch(/Gemini: 5-hour window 95% left.* · as of \d{4}-/)
    expect(result.ok && result.data.models.map((model) => model.id)).toContain('gemini-flash')
    expect(await catalog.read()).toEqual(result)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()
  })
  it('keeps models when the usage read refuses', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(new Error('refused'), ''))
    const result = await createModelCatalog({ discover: async () => [runtime], spawn: vi.fn() }).read()
    expect(result.ok && result.data.models.map((model) => model.id)).toContain('gemini-flash')
    expect(result.ok && result.data.usageWindows).toBeUndefined()
  })
  it('keeps both readings beside their models without asking either runtime for a turn', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(answer())))
    const fake = codexServer()
    const codex = { ...runtime, id: 'codex', executable: { ...executable, commandName: 'codex' } } as RuntimeDiscovery
    const result = await createModelCatalog({ discover: async () => [runtime, codex], spawn: () => fake.process }).read()
    expect(result.ok && result.data.usageWindows?.antigravity).toContain('95% left')
    expect(result.ok && result.data.usageWindows?.codex).toContain('12% used')
    expect(fake.asked).toEqual(['initialize', 'model/list', 'account/rateLimits/read'])
  })
  it('keeps Antigravity usage even when the Codex model probe fails', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => callback(null, JSON.stringify(answer())))
    const fake = codexServer(true)
    const codex = { ...runtime, id: 'codex', executable: { ...executable, commandName: 'codex' } } as RuntimeDiscovery
    const result = await createModelCatalog({ discover: async () => [runtime, codex], spawn: () => fake.process }).read()
    expect(result.ok && result.data.usageWindows?.antigravity).toContain('95% left')
    expect(result.ok && result.data.models.some(model => model.id === 'gemini-flash')).toBe(true)
  })
  it('does not run usage for missing, unready or non-agy discoveries', async () => {
    exec.mockClear()
    for (const entry of [{ ...runtime, executable: undefined }, { ...runtime, readiness: 'unknown' as const },
      { ...runtime, executable: { ...executable, commandName: 'antigravity' } }]) {
      await createModelCatalog({ discover: async () => [entry], spawn: vi.fn() }).read()
    }
    expect(exec).not.toHaveBeenCalled()
  })
})
