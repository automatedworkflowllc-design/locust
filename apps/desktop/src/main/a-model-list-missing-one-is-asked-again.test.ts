import { describe, expect, it } from 'vitest'

import { createModelCatalog, listsItsModelsButListedNone } from './model-catalog.js'

/*
 * Colin, 2026-10-02: "only account default is popping up for opencode". A
 * slow launch's `opencode models` came back empty; the catalogue kept that
 * answer for ten minutes, so every re-read the window made got it again.
 * A list missing a ready runtime's models is not kept (0.552).
 */
const ready = (id: string, models: readonly { id: string; displayName: string }[] | undefined) => ({
  id, readiness: 'ready', availability: 'available', ...(models === undefined ? {} : { modelHints: { aliases: [], efforts: [], models } })
}) as never

describe('a model list missing a ready runtime is asked for again', () => {
  it('names the case', () => {
    expect(listsItsModelsButListedNone([ready('opencode', undefined)])).toBe(true)
    expect(listsItsModelsButListedNone([ready('opencode', [{ id: 'opencode/a-free', displayName: 'A' }])])).toBe(false)
    expect(listsItsModelsButListedNone([ready('copilot', undefined)])).toBe(false)
  })

  it('reads again instead of keeping the incomplete answer', async () => {
    let calls = 0
    const opencode = ready('opencode', [{ id: 'opencode/a-free', displayName: 'A' }])
    const catalog = createModelCatalog({
      discover: async () => {
        calls += 1
        // First: Cursor is ready but listed nothing. Then it is not ready at all.
        return calls === 1 ? [opencode, ready('cursor', undefined)] : [opencode]
      },
      spawn: (() => { throw new Error('no codex here') }) as never
    })
    const first = await catalog.read()
    const second = await catalog.read()
    const third = await catalog.read()
    expect(first.ok).toBe(true)
    expect(calls).toBe(3 - 1)
    // Complete from the second read on, so it is kept.
    expect(third).toBe(second)
  })
})
