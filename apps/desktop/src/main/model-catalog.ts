import { createAppServerClient } from '@teammate/runtime-adapters'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { PublicModel, ModelCatalogResponse } from '../shared/ipc.js'
import type { AppServerProcess } from './app-server-mission.js'

/**
 * The model catalog.
 *
 * `model/list` is an app-server call, so reading it means briefly starting one.
 * That is worth doing once: it is the only source of real model ids and of each
 * model's supported reasoning efforts, and without it the shell would keep
 * showing `account-default` and an effort menu that cannot know what it may
 * offer.
 *
 * It fails SOFT. A catalog that cannot be read means the picker falls back to
 * the account default -- which is what the exec transport uses anyway -- rather
 * than the app refusing to start a mission.
 */

const PROBE_TIMEOUT_MS = 20_000
/** How long a successful read stays good. Models change on release, not hourly. */
const CACHE_MS = 10 * 60 * 1000
const MAX_MODELS = 40

export interface ModelCatalogOptions {
  readonly discover: () => Promise<readonly RuntimeDiscovery[]>
  readonly spawn: (executablePath: string, args: readonly string[]) => AppServerProcess
  readonly now?: () => number
}

export interface ModelCatalog {
  read(): Promise<ModelCatalogResponse>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the protocol's model list into the product's own shape. Every field is
 * checked: a model without an id is unusable, and a model whose efforts cannot
 * be read is reported as supporting none rather than as supporting all.
 */
export function parseModels(result: unknown): readonly PublicModel[] {
  const data = isObject(result) && Array.isArray(result.data) ? result.data : []
  const models: PublicModel[] = []
  for (const entry of data.slice(0, MAX_MODELS)) {
    if (!isObject(entry)) continue
    const id = typeof entry.id === 'string' ? entry.id : undefined
    if (id === undefined || id.length === 0) continue
    if (entry.hidden === true) continue
    const efforts: string[] = []
    if (Array.isArray(entry.supportedReasoningEfforts)) {
      for (const effort of entry.supportedReasoningEfforts) {
        const name = isObject(effort) ? effort.reasoningEffort : effort
        if (typeof name === 'string' && name.length > 0 && !efforts.includes(name)) efforts.push(name)
      }
    }
    models.push({
      id,
      displayName: typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : id,
      description: typeof entry.description === 'string' ? entry.description.slice(0, 200) : '',
      supportedEfforts: efforts
    })
  }
  return models
}

export function createModelCatalog(options: ModelCatalogOptions): ModelCatalog {
  const now = options.now ?? (() => Date.now())
  let cached: { readonly at: number; readonly response: ModelCatalogResponse } | undefined
  let inFlight: Promise<ModelCatalogResponse> | undefined

  const probe = async (): Promise<ModelCatalogResponse> => {
    const runtimes = await options.discover()
    const codex = runtimes.find((entry) => entry.id === 'codex')
    if (codex?.readiness !== 'ready' || codex.executable === undefined) {
      return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Codex CLI is not ready.' } }
    }

    const child = options.spawn(codex.executable.executablePath, [
      ...codex.executable.prefixArgs,
      'app-server'
    ])
    const client = createAppServerClient({
      transport: { send: (line) => child.write(line), close: () => child.kill() },
      onNotification: () => undefined,
      // Nothing should be able to ask this probe for permission: it starts no
      // turn. Refusing is the only correct answer.
      onRequest: async () => ({ decision: 'reject' }),
      requestTimeoutMs: PROBE_TIMEOUT_MS
    })
    child.onData((chunk) => client.accept(chunk))

    try {
      await client.request('initialize', { clientInfo: { name: 'locust', version: '0.1.0' } })
      client.notify('initialized')
      const result = await client.request('model/list', {})
      const models = parseModels(result)
      if (models.length === 0) {
        return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'No models were reported.' } }
      }
      return { ok: true, data: { models } }
    } catch {
      return {
        ok: false,
        error: { code: 'MODELS_UNAVAILABLE', message: 'The model list could not be read.' }
      }
    } finally {
      // Always take the server down. This probe exists to answer one question.
      client.dispose('model catalog read finished')
      child.kill()
    }
  }

  return {
    read(): Promise<ModelCatalogResponse> {
      const held = cached
      if (held !== undefined && now() - held.at < CACHE_MS) return Promise.resolve(held.response)
      // One probe at a time. Two windows asking at once must not start two
      // servers, and the second caller gets the first one's answer.
      if (inFlight !== undefined) return inFlight
      const running = probe()
        .then((response) => {
          // Only a success is cached: a transient failure must not pin the
          // picker to "unavailable" for the next ten minutes.
          if (response.ok) cached = { at: now(), response }
          return response
        })
        .finally(() => {
          inFlight = undefined
        })
      inFlight = running
      return running
    }
  }
}
