import { describe, expect, it, vi } from 'vitest'

import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import type { PublicModel } from '../shared/ipc.js'

import {
  accountDefaultModel,
  withAccountDefaults,
  claudeModelsFrom,
  createModelCatalog,
  cursorModelsFrom,
  sharedCursorName,
  parseModels,
  splitCursorModelId
} from './model-catalog.js'
import type { AppServerRunProcess as AppServerProcess } from '@teammate/runtime-adapters'

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
    // Two from the protocol, plus the account-default row the picker needs
    // in order to have an ACTIVE row for the route a fresh profile is on.
    expect(response.ok && response.data.models).toHaveLength(3)
    expect(response.ok && response.data.models[0]?.id).toBe('account-default')
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

describe('Cursor models from what its CLI listed', () => {
  const cursor = (readiness: RuntimeDiscovery['readiness'], hints?: RuntimeDiscovery['modelHints']): RuntimeDiscovery => ({
    ...codexRuntime(readiness),
    id: 'cursor',
    displayName: 'Cursor Agent',
    ...(hints === undefined ? {} : { modelHints: hints })
  })

  it('collapses the efforts Cursor lists as separate models into one model with efforts', () => {
    // A real account lists 217 of these. They are not 217 models: they are a
    // few dozen, each listed once per effort, which turned the picker into a
    // wall nobody could read.
    const models = cursorModelsFrom([
      cursor('ready', {
        aliases: [],
        efforts: [],
        models: [
          { id: 'composer-2.5', displayName: 'Composer 2.5' },
          { id: 'composer-2.5-fast', displayName: 'Composer 2.5 Fast' },
          { id: 'cursor-grok-4.6-low', displayName: 'Cursor Grok 4.6 Low' },
          { id: 'cursor-grok-4.6-high', displayName: 'Cursor Grok 4.6' },
          { id: 'cursor-grok-4.6-high-fast', displayName: 'Cursor Grok 4.6 Fast' }
        ]
      })
    ])

    // Grok stands on the variant Cursor lists under the bare name -- its
    // default -- rather than on whichever variant happened to come first.
    expect(models.map((model) => model.id)).toEqual(['composer-2.5', 'cursor-grok-4.6-high'])
    const composer = models[0]
    expect(composer?.displayName).toBe('Composer 2.5')
    expect(composer?.supportedEfforts).toEqual(['fast'])
    expect(composer?.variants).toEqual({ fast: 'composer-2.5-fast' })
    expect(composer?.defaultEffort).toBeUndefined()

    // Grok appears only through its variants, so it is named by the words
    // they share -- Cursor's own name, never the id -- and every effort is
    // offered.
    const grok = models[1]
    expect(grok?.displayName).toBe('Cursor Grok 4.6')
    expect(grok?.defaultEffort).toBe('high')
    expect(grok?.supportedEfforts).toEqual(['low', 'high', 'high-fast'])
    expect(grok?.variants).toEqual({
      low: 'cursor-grok-4.6-low',
      high: 'cursor-grok-4.6-high',
      'high-fast': 'cursor-grok-4.6-high-fast'
    })
  })

  it('splits an id into the model and the effort, longest suffix first', () => {
    expect(splitCursorModelId('cursor-grok-4.6-high-fast')).toEqual({ family: 'cursor-grok-4.6', effort: 'high-fast' })
    expect(splitCursorModelId('gpt-5.3-codex-xhigh')).toEqual({ family: 'gpt-5.3-codex', effort: 'xhigh' })
    expect(splitCursorModelId('auto')).toEqual({ family: 'auto' })
    // A name that IS an effort word must not be split into nothing.
    expect(splitCursorModelId('fast')).toEqual({ family: 'fast' })
    // The levels Cursor added: max, none and minimal are levels, not models.
    expect(splitCursorModelId('claude-opus-5-5-max-fast')).toEqual({ family: 'claude-opus-5-5', effort: 'max-fast' })
    expect(splitCursorModelId('gpt-5.6-sol-none')).toEqual({ family: 'gpt-5.6-sol', effort: 'none' })
    expect(splitCursorModelId('muse-spark-1.3-minimal')).toEqual({ family: 'muse-spark-1.3', effort: 'minimal' })
    // GPT-5.5 spells xhigh out.
    expect(splitCursorModelId('gpt-5.5-extra-high-fast')).toEqual({ family: 'gpt-5.5', effort: 'xhigh-fast' })
    // Thinking is a model of its own, on either side of the level.
    expect(splitCursorModelId('claude-opus-5-thinking-high-fast')).toEqual({ family: 'claude-opus-5-thinking', effort: 'high-fast' })
    expect(splitCursorModelId('claude-4.6-opus-max-thinking')).toEqual({ family: 'claude-4.6-opus-thinking', effort: 'max' })
    expect(splitCursorModelId('claude-4.5-sonnet-thinking')).toEqual({ family: 'claude-4.5-sonnet-thinking' })
  })

  it('names every model the way Cursor does, on the list a real account printed', () => {
    // `cursor-agent --list-models`, 2026-09-23, the lines for five models --
    // zero-width padding and doubled spaces as Cursor printed them. Before,
    // twenty-six of the account's rows read as ids (`claude-opus-5-5`), and
    // `-max`, `-none` and `-minimal` were rows of their own.
    const listed = [
      ['claude-opus-5-5-low', 'Claude Opus 5.5 1M Low'],
      ['claude-opus-5-5-low-fast', 'Claude Opus 5.5 1M Low Fast'],
      ['claude-opus-5-5-medium', 'Claude Opus 5.5 1M'],
      ['claude-opus-5-5-medium-fast', 'Claude Opus 5.5 1M Fast'],
      ['claude-opus-5-5-xhigh', 'Claude Opus 5.5 1M Extra High'],
      ['claude-opus-5-5-max', 'Claude Opus 5.5 1M Max'],
      ['claude-opus-5-5-max-fast', 'Claude Opus 5.5 1M Max Fast'],
      ['claude-opus-5-thinking-high', 'Claude Opus 5 1M Thinking'],
      ['claude-opus-5-thinking-high-fast', 'Claude Opus 5 1M Thinking Fast'],
      ['claude-opus-5-thinking-low', 'Claude Opus 5 1M Low Thinking'],
      ['claude-opus-5-thinking-low-fast', 'Claude Opus 5 1M Low Thinking Fast'],
      ['claude-opus-5-thinking-max', 'Claude Opus 5 1M Max Thinking'],
      ['claude-fable-5-1-low', 'Claude Fable 5.1 1M Low (NO ZDR)'],
      ['claude-fable-5-1-high', 'Claude Fable 5.1 1M (NO ZDR)'],
      ['claude-fable-5-1-max', 'Claude Fable 5.1 1M Max (NO ZDR)'],
      ['grok-4.7-low', 'Grok 4.7  Low'],
      ['grok-4.7-low-fast', 'Grok 4.7  Low Fast\u200B\u200B'],
      ['grok-4.7-high', 'Grok 4.7  High'],
      ['kimi-k3-low', 'Kimi K3 Low'],
      ['kimi-k3-high', 'Kimi K3 High'],
      ['kimi-k3-max', 'Kimi K3']
    ].map(([id, displayName]) => ({ id: id as string, displayName: displayName as string }))
    const models = cursorModelsFrom([cursor('ready', { aliases: [], efforts: [], models: listed })])
    const row = (name: string) => models.find((model) => model.displayName === name)

    expect(models.map((model) => model.displayName)).toEqual([
      'Claude Opus 5.5 1M',
      'Claude Opus 5 1M Thinking',
      'Claude Fable 5.1 1M (NO ZDR)',
      'Grok 4.7',
      'Kimi K3'
    ])
    // Each stands on Cursor's default, and a new route starts at its level.
    expect(row('Claude Opus 5.5 1M')?.id).toBe('claude-opus-5-5-medium')
    expect(row('Claude Opus 5.5 1M')?.defaultEffort).toBe('medium')
    expect(row('Claude Opus 5.5 1M')?.variants?.['max-fast']).toBe('claude-opus-5-5-max-fast')
    expect(row('Claude Opus 5 1M Thinking')?.defaultEffort).toBe('high')
    expect(row('Claude Fable 5.1 1M (NO ZDR)')?.defaultEffort).toBe('high')
    expect(row('Kimi K3')?.id).toBe('kimi-k3-max')
    expect(row('Kimi K3')?.supportedEfforts).toEqual(['low', 'high', 'max'])
    // Grok 4.7 names every level, so Cursor states no default and none is
    // claimed; Locust's own rule decides, as before.
    expect(row('Grok 4.7')?.defaultEffort).toBeUndefined()
    expect(row('Grok 4.7')?.id).toBe('grok-4.7-low')
  })

  it('reads the name a family shares, never inventing a word', () => {
    expect(sharedCursorName(['Claude Opus 5 1M Low Thinking', 'Claude Opus 5 1M Thinking', 'Claude Opus 5 1M Extra High Thinking'])).toBe('Claude Opus 5 1M Thinking')
    expect(sharedCursorName(['GPT-5.5 1M None', 'GPT-5.5 1M', 'GPT-5.5 1M High'])).toBe('GPT-5.5 1M')
    expect(sharedCursorName(['Grok 4.7  Low', 'Grok 4.7  High'])).toBe('Grok 4.7')
    // Only one variant: its name is the name.
    expect(sharedCursorName(['Claude Sonnet 4.6 1M'])).toBe('Claude Sonnet 4.6 1M')
    // Nothing shared, nothing claimed.
    expect(sharedCursorName(['Alpha', 'Beta'])).toBeUndefined()
    expect(sharedCursorName([])).toBeUndefined()
  })

  it('offers nothing for a Cursor that is signed out, or that listed nothing', () => {
    expect(cursorModelsFrom([cursor('authentication-required', { aliases: ['composer-2.5'], efforts: [], models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }] })])).toEqual([])
    expect(cursorModelsFrom([cursor('ready', { aliases: [], efforts: [] })])).toEqual([])
    expect(cursorModelsFrom([codexRuntime()])).toEqual([])
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
    // The advertised three, then `haiku`: measured to work, never named in
    // the help -- see CLAUDE_ALIASES_MEASURED.
    expect(models.filter((model) => model.older !== true).map((model) => model.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(models.every((model) => model.runtime === 'claude')).toBe(true)
    expect(models[0]?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('offers the cheapest family the help leaves out, once, and only beside advertised ones', () => {
    /*
     * The help's aliases are EXAMPLES, and the picker offered exactly the
     * examples -- so Haiku, the cheapest Claude, could not be picked at all
     * (found 2026-09-22, when a drive asked for it and the search came back
     * empty). A help that names it already is not given it twice, and a help
     * that names no aliases is given none.
     */
    const named = claudeModelsFrom([claude('ready', { aliases: ['sonnet', 'haiku'], efforts: [] })])
    expect(named.filter((model) => model.older !== true).map((model) => model.id)).toEqual(['sonnet', 'haiku'])
    const none = claudeModelsFrom([claude('ready', { aliases: [], efforts: ['high'] })])
    expect(none).toEqual([])
    const haiku = claudeModelsFrom([claude('ready', { aliases: ['opus'], efforts: [] })])
      .filter((model) => model.older !== true)
      .at(-1)
    expect(haiku?.displayName).toBe('Haiku 4.5')
  })

  it("names the version each alias runs, from Claude Code's own alias table", () => {
    /*
     * Colin, 2026-09-22: "can we have the model type listed for claude?
     * right now it just shows opus latest model, fable latest model". The
     * names come from the registry compiled into Claude Code 2.1.280
     * (`aliases.<family>.default`) -- see shared/claude-models.ts.
     */
    const models = claudeModelsFrom([claude('ready', { aliases: ['fable', 'opus', 'sonnet'], efforts: [] })])
    expect(models.filter((model) => model.older !== true).map((model) => model.displayName)).toEqual(['Fable 5.1', 'Opus 5.5', 'Sonnet 5', 'Haiku 4.5'])
    // What the alias is for: it moves with its family.
    expect(models[1]?.description).toBe('Always the newest Opus')
    // An alias the table does not know keeps its own name, not a made-up version.
    const unknown = claudeModelsFrom([claude('ready', { aliases: ['mythic'], efforts: [] })])
    expect(unknown[0]?.displayName).toBe('Mythic')
  })

  it('offers the older versions after the current ones, marked for the fold', () => {
    const models = claudeModelsFrom([claude('ready', { aliases: ['fable', 'opus', 'sonnet'], efforts: ['low', 'high'] })])
    const older = models.filter((model) => model.older === true)
    expect(models.findIndex((model) => model.older === true)).toBe(4)
    expect(older.map((model) => model.displayName)).toEqual([
      'Opus 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Opus 4.5', 'Fable 5', 'Sonnet 4.6', 'Sonnet 4.5'
    ])
    // Their levels are their own, not the aliases' advertised ones.
    expect(older.find((model) => model.id === 'claude-sonnet-4-5')?.supportedEfforts).toEqual([])
    // A CLI that names no aliases is given no full names either.
    expect(claudeModelsFrom([claude('ready', { aliases: [], efforts: ['high'] })])).toEqual([])
  })

  it("keeps the account default's levels to the current models", () => {
    // Two older versions report no levels at all; counted, they would empty
    // the account default's for everyone.
    const models = withAccountDefaults(claudeModelsFrom([claude('ready', { aliases: ['opus'], efforts: ['low', 'high'] })]))
    const fallback = models.find((model) => model.runtime === 'claude' && model.id === 'account-default')
    expect(fallback?.supportedEfforts).toEqual(['low', 'high'])
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
    // Claude gets its own account-default row now, the way Codex always had
    // one: `defaultRoute` can stamp `account-default` on whichever runtime is
    // usable, and each one needs a row of its own to be the ACTIVE one.
    expect(response.data.models.filter((model) => model.older !== true).map((model) => `${model.runtime}:${model.id}`)).toEqual([
      'claude:account-default',
      'claude:opus',
      'claude:haiku'
    ])
  })
})

describe('the account default is a row you can select', () => {
  // It is the route a fresh profile starts on, and it was the only route in
  // the app naming a model no list contained -- so the picker drew no ACTIVE
  // row, and the effort chips that hang off that row had nowhere to attach.
  // With the composer's effort chip removed in the same design pass, a new
  // person had no way to choose effort at all.
  const model = (id: string, supportedEfforts: readonly string[]): PublicModel => ({
    id,
    runtime: 'codex',
    displayName: id,
    description: '',
    supportedEfforts
  })

  it('offers only the levels every listed model agrees on', () => {
    // A union would draw a control that silently does nothing whenever the
    // account resolves to a model that does not accept the level.
    expect(
      accountDefaultModel([
        model('gpt-6-astra', ['low', 'medium', 'high', 'ultra']),
        model('gpt-5.6-sol', ['low', 'medium', 'high']),
        model('gpt-5.4-mini', ['low', 'high'])
      ])?.supportedEfforts
    ).toEqual(['low', 'high'])
  })

  it('reports none rather than guessing when the models share nothing', () => {
    expect(
      accountDefaultModel([model('a', ['low']), model('b', ['high'])])?.supportedEfforts
    ).toEqual([])
  })

  it('stays quiet when nothing was listed: there is no honest claim to make', () => {
    expect(accountDefaultModel([])).toBeUndefined()
  })

  it('never counts a previous account-default row as evidence about itself', () => {
    expect(accountDefaultModel([model('account-default', ['low', 'high'])])).toBeUndefined()
  })

  it('is named for what it is, and sits under codex', () => {
    const row = accountDefaultModel([model('gpt-5.6-sol', ['low'])])
    expect(row).toMatchObject({ id: 'account-default', runtime: 'codex', displayName: 'Account default' })
  })
})

describe('every runtime that lists models gets an Account default row', () => {
  // `account-default` is not a Codex idea -- codex-mission.ts calls it "the
  // shell's word for send no --model" and every runtime honours it that way.
  // Building the row for Codex alone meant that once discovery preferred
  // OpenCode on a fresh machine, the route a new person landed on had no row
  // again: a lowercase placeholder, no ACTIVE row, no effort. Caught by an
  // independent review as an edge case (2026-09-07) and made the default case
  // by the cold-start fix the same night.
  const model = (
    runtime: PublicModel['runtime'],
    id: string,
    supportedEfforts: readonly string[] = []
  ): PublicModel => ({ id, runtime, displayName: id, description: '', supportedEfforts })

  it('gives each runtime its own row, in front of that runtime’s models', () => {
    const withDefaults = withAccountDefaults([
      model('codex', 'gpt-5.6-sol', ['low', 'high']),
      model('opencode', 'big-pickle'),
      model('claude', 'sonnet', ['low', 'high'])
    ])
    expect(withDefaults.filter((row) => row.id === 'account-default').map((row) => row.runtime).sort()).toEqual([
      'claude',
      'codex',
      'opencode'
    ])
  })

  it('carries each runtime’s own intersection, not a shared one', () => {
    const withDefaults = withAccountDefaults([
      model('codex', 'a', ['low', 'medium', 'high']),
      model('codex', 'b', ['low', 'high']),
      model('claude', 'c', ['xhigh'])
    ])
    const forRuntime = (runtime: string): readonly string[] =>
      withDefaults.find((row) => row.id === 'account-default' && row.runtime === runtime)?.supportedEfforts ?? []
    expect(forRuntime('codex')).toEqual(['low', 'high'])
    expect(forRuntime('claude')).toEqual(['xhigh'])
  })

  it('adds nothing for a runtime that listed nothing', () => {
    expect(withAccountDefaults([]).length).toBe(0)
  })

  it('never stacks a second default on a list that already has one', () => {
    const once = withAccountDefaults([model('codex', 'a', ['low'])])
    expect(withAccountDefaults(once).filter((row) => row.id === 'account-default').length).toBe(1)
  })
})
