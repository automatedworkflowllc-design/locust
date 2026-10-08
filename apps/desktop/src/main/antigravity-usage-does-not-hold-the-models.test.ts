import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import { createModelCatalog } from './model-catalog.js'

/*
 * 0.709. `agy -p /usage` took 7.3 s on Colin's machine (2026-10-08) and every
 * runtime's models waited for it: OpenCode's free rows reached the picker 14 s
 * after "ready", and Home's "Use a free model" was missing until then. The
 * list now waits a moment for Antigravity's usage, goes without it, and a
 * reading that comes later joins the next answer and asks the window to read again.
 */
function runtime(id: 'opencode' | 'antigravity' | 'codex', commandName: string, extra: Partial<RuntimeDiscovery> = {}): RuntimeDiscovery {
  return {
    id,
    kind: 'agent-runtime',
    displayName: id,
    optional: true,
    availability: 'available',
    readiness: 'ready',
    executable: { commandName, discoveredPath: `C:\\tools\\${commandName}.exe`, executablePath: `C:\\tools\\${commandName}.exe`, prefixArgs: [], kind: 'native' },
    version: { raw: `${commandName} 1.0.0`, version: '1.0.0', major: 1, minor: 0, patch: 0 },
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: [],
    ...extra
  }
}

const runtimes = (): readonly RuntimeDiscovery[] => [
  runtime('codex', 'codex', { readiness: 'authentication-required' }),
  runtime('opencode', 'opencode', { modelHints: { aliases: [], efforts: [], models: [{ id: 'opencode/space-bunny-free', displayName: 'space-bunny-free' }] } }),
  runtime('antigravity', 'agy')
]

afterEach(() => {
  vi.useRealTimers()
})

describe("Antigravity's usage does not hold the model list", () => {
  it('answers with OpenCode\'s free model without waiting for a slow usage reading, and shows the reading when it comes', async () => {
    vi.useFakeTimers()
    let finish: (reading: string) => void = () => undefined
    const slow = new Promise<string>((resolve) => {
      finish = resolve
    })
    const late = vi.fn()
    const catalog = createModelCatalog({
      discover: async () => runtimes(),
      spawn: () => {
        throw new Error('must not spawn')
      },
      readAntigravity: () => slow,
      onLateUsage: late
    })

    const answer = catalog.read()
    await vi.advanceTimersByTimeAsync(1_500)
    const first = await answer
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.models.map((model) => model.id)).toContain('opencode/space-bunny-free')
    expect(first.data.usageWindows?.antigravity).toBeUndefined()
    expect(late).not.toHaveBeenCalled()

    finish('Gemini: weekly window 67% left')
    await vi.advanceTimersByTimeAsync(0)
    expect(late).toHaveBeenCalledTimes(1)

    // The cached list, read again, carries the reading.
    const again = await catalog.read()
    expect(again.ok && again.data.usageWindows?.antigravity).toMatch(/^Gemini: weekly window 67% left · as of /)
  })

  it('still includes a reading that is quick, and asks nothing more of the window', async () => {
    const late = vi.fn()
    const catalog = createModelCatalog({
      discover: async () => runtimes(),
      spawn: () => {
        throw new Error('must not spawn')
      },
      readAntigravity: async () => 'Gemini: 5-hour window 95% left',
      onLateUsage: late
    })
    const response = await catalog.read()
    expect(response.ok && response.data.usageWindows?.antigravity).toMatch(/^Gemini: 5-hour window 95% left · as of /)
    expect(late).not.toHaveBeenCalled()
  })

  it('a failed reading costs the list nothing', async () => {
    const catalog = createModelCatalog({
      discover: async () => runtimes(),
      spawn: () => {
        throw new Error('must not spawn')
      },
      readAntigravity: async () => {
        throw new Error('agy said no')
      }
    })
    const response = await catalog.read()
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.models.map((model) => model.id)).toContain('opencode/space-bunny-free')
    expect(response.data.usageWindows?.antigravity).toBeUndefined()
  })
})
