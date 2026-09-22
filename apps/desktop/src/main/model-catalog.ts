import { createAppServerClient } from '@teammate/runtime-adapters'
import type { MissionRuntimeId, RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { PublicModel, ModelCatalogResponse } from '../shared/ipc.js'
import type { AppServerRunProcess as AppServerProcess } from '@teammate/runtime-adapters'

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
/**
 * The route a fresh profile starts on, before any model is chosen.
 *
 * Stated here rather than imported: the main process does not reach into
 * the renderer, and this id is protocol-level either way.
 */
const ACCOUNT_DEFAULT_MODEL = 'account-default'

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
      runtime: 'codex',
      displayName: typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : id,
      description: typeof entry.description === 'string' ? entry.description.slice(0, 200) : '',
      supportedEfforts: efforts
    })
  }
  return models
}

/**
 * The account default, as a row you can actually select, for one runtime.
 *
 * It is the route a fresh profile starts on, and it was the only route in the
 * app that named a model no list contained -- so the picker drew no ACTIVE row
 * for it, and the effort levels, which hang off that row, had nowhere to go.
 *
 * Built PER RUNTIME. `account-default` is not a Codex idea: codex-mission.ts
 * calls it "the shell's word for send no --model", and every runtime honours
 * it that way. Building it for Codex alone meant that once discovery started
 * preferring OpenCode on a fresh machine, the route a new person landed on
 * had no row again -- the same defect one runtime to the left.
 *
 * The levels offered are the ones EVERY listed model of that runtime agrees
 * on. An intersection rather than a union, because the account decides which
 * model answers, and a level only some of them accept would be a control that
 * silently does nothing. Effort itself is safe to offer here: it travels
 * separately from the model on every runtime that takes one.
 *
 * Undefined when that runtime listed nothing -- then there is no honest claim
 * to make about what the account supports, and the picker is right to stay
 * quiet.
 *
 * The intersection is also what keeps this SAFE on the runtimes whose command
 * builders refuse an effort outright ("Cursor Agent takes no effort level",
 * and the same for Gemini, OpenCode and Copilot). Each of those is a runtime
 * whose models report no levels, so the intersection is empty, so no chip is
 * drawn and nothing is sent. A union would have offered a level on the very
 * runtimes that throw on one.
 */
export function accountDefaultModel(
  models: readonly PublicModel[],
  runtime: MissionRuntimeId = 'codex'
): PublicModel | undefined {
  const listed = models.filter(
    (model) => model.runtime === runtime && model.id !== ACCOUNT_DEFAULT_MODEL
  )
  if (listed.length === 0) return undefined
  const shared = listed
    .map((model) => model.supportedEfforts)
    .reduce<readonly string[]>(
      (kept, efforts) => kept.filter((effort) => efforts.includes(effort)),
      listed[0]?.supportedEfforts ?? []
    )
  return {
    id: ACCOUNT_DEFAULT_MODEL,
    runtime,
    displayName: 'Account default',
    description: 'Whatever model your account uses. The effort levels below apply to all of them.',
    supportedEfforts: shared
  }
}

/**
 * Every runtime's account-default row, in front of the models they belong to.
 *
 * One per runtime that listed anything, because `defaultRoute` can stamp
 * `account-default` on any of them and each one needs a row of its own to be
 * the ACTIVE one.
 */
export function withAccountDefaults(models: readonly PublicModel[]): readonly PublicModel[] {
  // Idempotent: a runtime that already carries its row is left alone. Two
  // call sites reach this (the probe, and the early return when Codex is not
  // ready), and a list that went through both would otherwise show the same
  // "Account default" twice.
  const already = new Set(
    models.filter((model) => model.id === ACCOUNT_DEFAULT_MODEL).map((model) => model.runtime)
  )
  const defaults = [...new Set(models.map((model) => model.runtime))]
    .filter((runtime) => !already.has(runtime))
    .map((runtime) => accountDefaultModel(models, runtime))
    .filter((row): row is PublicModel => row !== undefined)
  return [...defaults, ...models]
}

/**
 * Aliases Claude Code accepts that its `--help` does not name.
 *
 * The help gives EXAMPLES -- "an alias for the latest model (e.g. 'fable',
 * 'opus', or 'sonnet')" -- and the picker offered exactly the examples, so
 * the cheapest family could not be chosen in Locust at all. Measured, not
 * assumed: `claude --model haiku` on Claude Code 2.1.280 ran as
 * claude-haiku-4-5-20251001 (2026-09-22, the background-task capture).
 * Offered only beside advertised aliases, so a CLI whose help stops naming
 * aliases at all is not handed one by this list.
 */
export const CLAUDE_ALIASES_MEASURED: readonly string[] = ['haiku']

/**
 * Claude Code's models, from what its CLI advertised at discovery. An alias
 * resolves to the newest model of that family on the runtime's side, which is
 * why it is offered as the alias rather than as a version this build guessed.
 */
export function claudeModelsFrom(runtimes: readonly RuntimeDiscovery[]): readonly PublicModel[] {
  const claude = runtimes.find((entry) => entry.id === 'claude')
  const hints = claude?.modelHints
  if (claude?.readiness !== 'ready' || hints === undefined) return []
  const aliases = hints.aliases.length === 0
    ? []
    : [...hints.aliases, ...CLAUDE_ALIASES_MEASURED.filter((alias) => !hints.aliases.includes(alias))]
  return aliases.map((alias) => ({
    id: alias,
    runtime: 'claude',
    // The alias IS the name here. Claude Code resolves it to whichever model
    // is newest in that family at the moment a mission starts, so a version
    // number printed here would be this build's guess about the runtime's
    // future -- the shell shows the resolved name once a mission has reported
    // one instead.
    displayName: `${alias.charAt(0).toUpperCase()}${alias.slice(1)}`,
    description: `Newest ${alias} model · resolved by Claude Code at launch`,
    supportedEfforts: hints.efforts
  }))
}

/** The effort suffixes Cursor encodes in a model id, longest first. */
const CURSOR_EFFORTS = [
  'xhigh-fast',
  'high-fast',
  'medium-fast',
  'low-fast',
  'xhigh',
  'high',
  'medium',
  'low',
  'fast'
] as const

/**
 * Split `cursor-grok-4.6-high-fast` into the model and the effort.
 *
 * Cursor lists every effort of every model as its own entry -- 217 of them on
 * a real account -- which turned the picker into a wall nobody could read.
 * They are one model with an effort each, which is what the picker already
 * knows how to show, and what the effort control exists for.
 */
export function splitCursorModelId(id: string): { readonly family: string; readonly effort?: string } {
  for (const effort of CURSOR_EFFORTS) {
    const suffix = `-${effort}`
    if (id.endsWith(suffix) && id.length > suffix.length) {
      return { family: id.slice(0, -suffix.length), effort }
    }
  }
  return { family: id }
}

/**
 * Cursor Agent's models, grouped. Each row is one model; its efforts are the
 * variants Cursor actually listed, and `variants` says which concrete id each
 * one means, because the effort travels inside the id rather than as a flag.
 */
export function cursorModelsFrom(runtimes: readonly RuntimeDiscovery[]): readonly PublicModel[] {
  const cursor = runtimes.find((entry) => entry.id === 'cursor')
  const listed = cursor?.modelHints?.models
  if (cursor?.readiness !== 'ready' || listed === undefined) return []

  const families = new Map<string, {
    displayName: string
    defaultId: string
    readonly variants: Record<string, string>
    readonly efforts: string[]
  }>()
  for (const model of listed) {
    const { family, effort } = splitCursorModelId(model.id)
    const held = families.get(family) ?? {
      // Until a plain variant turns up, the first one seen stands in, so a
      // family that only ever appears with an effort is still selectable.
      displayName: model.displayName,
      defaultId: model.id,
      variants: {},
      efforts: []
    }
    if (effort === undefined) {
      held.displayName = model.displayName
      held.defaultId = model.id
    } else {
      held.variants[effort] = model.id
      if (!held.efforts.includes(effort)) held.efforts.push(effort)
    }
    families.set(family, held)
  }

  return [...families.entries()].map(([family, held]) => ({
    id: held.defaultId,
    runtime: 'cursor' as const,
    // A family known only through its variants has no name of its own; the
    // id is then the honest label rather than one variant's name.
    displayName: held.efforts.length > 0 && held.defaultId !== family
      ? family
      : held.displayName,
    description: 'Listed by cursor-agent --list-models',
    supportedEfforts: held.efforts,
    ...(Object.keys(held.variants).length === 0 ? {} : { variants: held.variants })
  }))
}

/**
 * OpenCode's models, from `opencode models` at discovery: one `provider/model`
 * id per line. The ones ending in `-free` cost nothing and need no sign-in,
 * which is the whole reason this runtime is here; they are named as free.
 */
export function opencodeModelsFrom(runtimes: readonly RuntimeDiscovery[]): readonly PublicModel[] {
  const opencode = runtimes.find((entry) => entry.id === 'opencode')
  const listed = opencode?.modelHints?.models
  if (opencode?.readiness !== 'ready' || listed === undefined) return []
  return listed.map((model) => {
    const free = model.id.endsWith('-free')
    return {
      id: model.id,
      runtime: 'opencode' as const,
      displayName: model.displayName,
      description: free ? 'Free · no sign-in · listed by opencode models' : 'Listed by opencode models',
      supportedEfforts: []
    }
  })
}

/**
 * Copilot has no cheap way to list models: the ones an account may use are
 * only reported inside a run. So the catalog offers `auto`, which is real --
 * Copilot picks -- and never a name this build guessed.
 */
export function copilotModelsFrom(runtimes: readonly RuntimeDiscovery[]): readonly PublicModel[] {
  const copilot = runtimes.find((entry) => entry.id === 'copilot')
  if (copilot?.readiness !== 'ready') return []
  return [
    {
      id: 'auto',
      runtime: 'copilot' as const,
      displayName: 'Auto',
      description: 'Copilot picks the model your plan allows',
      supportedEfforts: []
    }
  ]
}

/**
 * Antigravity's three model tiers, exactly as its agent API names them. The
 * names are the host's, from the measured `--model=<flash_lite|flash|pro>`.
 */
export function antigravityModelsFrom(runtimes: readonly RuntimeDiscovery[]): readonly PublicModel[] {
  const antigravity = runtimes.find((entry) => entry.id === 'antigravity')
  const listed = antigravity?.modelHints?.models
  if (antigravity?.readiness !== 'ready' || listed === undefined) return []
  return listed.map((model) => ({
    id: model.id,
    runtime: 'antigravity' as const,
    displayName: model.displayName,
    description: model.description ?? 'Antigravity model tier',
    supportedEfforts: []
  }))
}

export function createModelCatalog(options: ModelCatalogOptions): ModelCatalog {
  const now = options.now ?? (() => Date.now())
  let cached: { readonly at: number; readonly response: ModelCatalogResponse } | undefined
  let inFlight: Promise<ModelCatalogResponse> | undefined

  const probe = async (): Promise<ModelCatalogResponse> => {
    const runtimes = await options.discover()
    // Each runtime's models come from its own source and fail on their own:
    // Claude's and Cursor's from what their CLIs advertised at discovery,
    // Codex's from a live server read.
    const advertisedModels = [
      ...claudeModelsFrom(runtimes),
      ...cursorModelsFrom(runtimes),
      ...opencodeModelsFrom(runtimes),
      ...copilotModelsFrom(runtimes),
      ...antigravityModelsFrom(runtimes)
    ]
    const codex = runtimes.find((entry) => entry.id === 'codex')
    if (codex?.readiness !== 'ready' || codex.executable === undefined) {
      return advertisedModels.length > 0
        ? { ok: true, data: { models: withAccountDefaults(advertisedModels) } }
        : { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Codex CLI is not ready.' } }
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
      // The route a fresh profile starts on gets a row of its own, for every
      // runtime, so the picker has something to mark ACTIVE and the effort
      // levels have somewhere to hang whichever runtime discovery settled on.
      const models = withAccountDefaults([...parseModels(result), ...advertisedModels])
      if (models.length === 0) {
        return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'No models were reported.' } }
      }
      return { ok: true, data: { models } }
    } catch {
      return advertisedModels.length > 0
        ? { ok: true, data: { models: withAccountDefaults(advertisedModels) } }
        : {
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
