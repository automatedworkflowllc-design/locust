import { describe, expect, it } from 'vitest'

import type { AppServerRunProcess as AppServerProcess, RuntimeDiscovery } from '@teammate/runtime-adapters'

import { createModelCatalog } from './model-catalog.js'

/**
 * CODEX'S USAGE IS READ WITH ITS MODELS (0.390).
 *
 * Colin, 2026-09-27, over his Home's cards: "codex usage isnt showing
 * either". A reading only ever came from a run, and his Codex runs predate
 * 0.388 keeping one. The catalog already starts Codex's app-server for
 * `model/list`; in the same session it now asks `account/rateLimits/read`
 * -- no turn spent -- whose shape (read off `codex app-server
 * generate-json-schema`, 0.157.1) is the snapshot a turn pushes.
 */
const RESETS = 1790363478

function codexRuntime(): RuntimeDiscovery {
  return {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: { commandName: 'codex', discoveredPath: 'C:\\tools\\codex.exe', executablePath: 'C:\\tools\\codex.exe', prefixArgs: [], kind: 'native' },
    version: { raw: 'codex 0.157.1', version: '0.157.1', major: 0, minor: 157, patch: 1 },
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: []
  } as unknown as RuntimeDiscovery
}

/** An app-server that answers each method as told; `error` answers with a JSON-RPC error. */
function server(answers: Readonly<Record<string, unknown>>) {
  const asked: string[] = []
  let onData: (chunk: string) => void = () => undefined
  const process: AppServerProcess = {
    write: (line) => {
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.id === undefined) return
      asked.push(message.method ?? '')
      const answer = answers[message.method ?? '']
      const reply =
        answer === 'error'
          ? { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } }
          : { jsonrpc: '2.0', id: message.id, result: answer ?? {} }
      queueMicrotask(() => onData(`${JSON.stringify(reply)}\n`))
    },
    kill: () => undefined,
    onData: (listener) => {
      onData = listener
    },
    onExit: () => undefined
  }
  return { process, asked }
}

const MODELS = { data: [{ id: 'gpt-6-luna', displayName: 'GPT-6-Luna', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }] }

describe("Codex's usage, read with its models", () => {
  it('comes back as a reading beside the models, in the words a turn’s reading uses', async () => {
    const fake = server({
      'model/list': MODELS,
      'account/rateLimits/read': {
        rateLimits: {
          limitId: 'codex',
          primary: { usedPercent: 34, windowDurationMins: 300, resetsAt: RESETS },
          secondary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: RESETS + 86400 },
          credits: { hasCredits: false, unlimited: false, balance: '0' },
          planType: 'plus'
        }
      }
    })
    const catalog = createModelCatalog({ discover: async () => [codexRuntime()], spawn: () => fake.process })
    const response = await catalog.read()
    expect(response.ok).toBe(true)
    expect(response.ok && response.data.usageWindows).toEqual({
      codex: `weekly window 71% used · resets ${new Date((RESETS + 86400) * 1000).toISOString()} · 5-hour window 34% used · resets ${new Date(RESETS * 1000).toISOString()}`
    })
    // In the same server session as the models: one server, two questions.
    expect(fake.asked).toEqual(['initialize', 'model/list', 'account/rateLimits/read'])
  })

  it('leaves the reading out -- and keeps the models -- when Codex cannot say', async () => {
    const refusing = server({ 'model/list': MODELS, 'account/rateLimits/read': 'error' })
    const refused = await createModelCatalog({ discover: async () => [codexRuntime()], spawn: () => refusing.process }).read()
    expect(refused.ok && refused.data.models.some((model) => model.id === 'gpt-6-luna')).toBe(true)
    expect(refused.ok && refused.data.usageWindows).toBeUndefined()

    const silent = server({ 'model/list': MODELS, 'account/rateLimits/read': { rateLimits: { credits: { hasCredits: false, unlimited: false } } } })
    const empty = await createModelCatalog({ discover: async () => [codexRuntime()], spawn: () => silent.process }).read()
    expect(empty.ok && empty.data.usageWindows).toBeUndefined()
  })
})
