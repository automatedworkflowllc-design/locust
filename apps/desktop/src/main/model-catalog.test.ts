import { describe, expect, it, vi } from 'vitest'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import { claudeModelsFrom, createModelCatalog, parseModels } from './model-catalog.js'
import type { AppServerProcess } from './app-server-mission.js'

const REAL_RESULT = {
  data: [
    {
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6-Sol',
      description: 'Latest frontier agentic coding model.',
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low' },
        { reasoningEffort: 'medium' },
        { reasoningEffort: 'high' },
        { reasoningEffort: 'xhigh' },
        { reasoningEffort: 'max' },
        { reasoningEffort: 'ultra' }
      ]
    },
    {
      id: 'gpt-5.4-mini',
      displayName: 'GPT-5.4-mini',
      supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
    }
  ]
}

function codexRuntime(readiness: RuntimeDiscovery['readiness'] = 'ready'): RuntimeDiscovery {
  return {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness,
    executable: {
      commandName: 'codex',
      discoveredPath: 'C:\\tools\\codex.exe',
      executablePath: 'C:\\tools\\codex.exe',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: 'codex 1.0.0', version: '1.0.0', major: 1, minor: 0, patch: 0 },
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: []
  }
}

function fakeServer(result: unknown = REAL_RESULT) {
  let killed = 0
  let onData: (chunk: string) => void = () => undefined
  const process: AppServerProcess = {
    write: (line) => {
      const message = JSON.parse(line) as Record<string, unknown>
      if (message.id === undefined) return
      const payload = message.method === 'model/list' ? result : {}
      queueMicrotask(() => onData(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: payload })}\n`))
    },
    kill: () => {
      killed += 1
    },
    onData: (listener) => {
      onData = listener
    },
    onExit: () => undefined
  }
  return { process, killCount: () => killed }
}

describe('parsing the protocol list', () => {
  it('reads real models and their own supported efforts', () => {
    const models = parseModels(REAL_RESULT)
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.4-mini'])
    // Effort is per model. Assuming a shared list is how a control ends up
    // offering something the model cannot honour.
    expect(models[0]?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    expect(models[1]?.supportedEfforts).toEqual(['low', 'high'])
  })

  it('drops a model with no id, and a hidden one', () => {
    const models = parseModels({
      data: [{ displayName: 'nameless' }, { id: 'secret', hidden: true }, { id: 'kept' }]
    })
    expect(models.map((model) => model.id)).toEqual(['kept'])
  })

  it('reports unreadable efforts as NONE rather than as all', () => {
    // Claiming support the runtime never advertised is the failure that makes
    // an effort control lie.
    const models = parseModels({ data: [{ id: 'x', supportedReasoningEfforts: 'nonsense' }] })
    expect(models[0]?.supportedEfforts).toEqual([])
  })

  it('survives a shape it does not recognize', () => {
    expect(parseModels(null)).toEqual([])
    expect(parseModels({ models: [{ id: 'x' }] })).toEqual([])
  })
})

describe('the catalog probe', () => {
  it('reads the list and shuts the server down again', async () => {
    const server = fakeServer()
    const catalog = createModelCatalog({
      discover: async () => [codexRuntime()],
      spawn: () => server.process
    })

    const response = await catalog.read()

    expect(response.ok).toBe(true)
    expect(response.ok && response.data.models).toHaveLength(2)
    // This probe exists to answer one question; leaving a server running would
    // be a background process the user never asked for.
    expect(server.killCount()).toBeGreaterThan(0)
  })

  it('caches a success instead of starting a server per call', async () => {
    const spawn = vi.fn(() => fakeServer().process)
    const catalog = createModelCatalog({ discover: async () => [codexRuntime()], spawn })

    await catalog.read()
    await catalog.read()

    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure', async () => {
    // A transient failure must not pin the picker to "unavailable" for the
    // rest of the cache window.
    const spawn = vi.fn(() => fakeServer({ data: [] }).process)
    const catalog = createModelCatalog({ discover: async () => [codexRuntime()], spawn })

    expect((await catalog.read()).ok).toBe(false)
    expect((await catalog.read()).ok).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('answers a second caller from the first probe rather than starting two', async () => {
    const spawn = vi.fn(() => fakeServer().process)
    const catalog = createModelCatalog({ discover: async () => [codexRuntime()], spawn })

    const [first, second] = await Promise.all([catalog.read(), catalog.read()])

    expect(first.ok && second.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('fails soft when the runtime is not ready, without spawning anything', async () => {
    const spawn = vi.fn(() => fakeServer().process)
    const catalog = createModelCatalog({
      discover: async () => [codexRuntime('authentication-required')],
      spawn
    })

    const response = await catalog.read()

    expect(response).toMatchObject({ ok: false, error: { code: 'MODELS_UNAVAILABLE' } })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('expires the cache so a new release is eventually seen', async () => {
    const spawn = vi.fn(() => fakeServer().process)
    let clock = 0
    const catalog = createModelCatalog({
      discover: async () => [codexRuntime()],
      spawn,
      now: () => clock
    })

    await catalog.read()
    clock += 11 * 60 * 1000
    await catalog.read()

    expect(spawn).toHaveBeenCalledTimes(2)
  })
})

describe('Claude models from what its CLI advertised', () => {
  const claude = (readiness: RuntimeDiscovery['readiness'], hints?: RuntimeDiscovery['modelHints']): RuntimeDiscovery => ({
    ...codexRuntime(readiness),
    id: 'claude',
    displayName: 'Claude Code',
    ...(hints === undefined ? {} : { modelHints: hints })
  })

  it('offers each advertised alias, tagged as Claude, with the advertised efforts', () => {
    const models = claudeModelsFrom([
      claude('ready', { aliases: ['fable', 'opus', 'sonnet'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] })
    ])
    expect(models.map((model) => model.id)).toEqual(['fable', 'opus', 'sonnet'])
    expect(models.every((model) => model.runtime === 'claude')).toBe(true)
    expect(models[0]?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('offers nothing for a Claude that is not ready, or that advertised nothing', () => {
    expect(claudeModelsFrom([claude('authentication-required', { aliases: ['fable'], efforts: [] })])).toEqual([])
    expect(claudeModelsFrom([claude('ready')])).toEqual([])
    expect(claudeModelsFrom([codexRuntime()])).toEqual([])
  })

  it('lists Claude models even when Codex cannot be read', async () => {
    const catalog = createModelCatalog({
      discover: async () => [codexRuntime('authentication-required'), claude('ready', { aliases: ['opus'], efforts: ['high'] })],
      spawn: () => {
        throw new Error('must not spawn')
      }
    })
    const response = await catalog.read()
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.data.models.map((model) => `${model.runtime}:${model.id}`)).toEqual(['claude:opus'])
  })
})
