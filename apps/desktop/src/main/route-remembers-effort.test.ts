import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore } from './teammate-store.js'

/**
 * A teammate's remembered route keeps its effort.
 *
 * Colin, 2026-09-16: "my effort levels are resetting." Two places dropped
 * it: the host built the route it remembered from three fields, and the
 * store rebuilt it from three again. Selecting the teammate then restored
 * runtime, model and mode and reset the level every time.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('the route a teammate is remembered on', () => {
  it('keeps the effort it was started with, and clears it when the next start has none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-effort-'))
    roots.push(root)
    const store = createTeammateStore({ rootDirectory: root })
    const wren = await store.create({ name: 'Wren', hue: 'lime', role: 'Code & Migrations' })
    await store.rememberRoute(wren.teammateId, { runtime: 'codex', model: 'gpt-5.2', mode: 'auto', effort: 'low' })
    expect((await store.list())[0]?.route).toEqual({ runtime: 'codex', model: 'gpt-5.2', mode: 'auto', effort: 'low' })
    // A fresh store reads the file, not memory.
    expect((await createTeammateStore({ rootDirectory: root }).list())[0]?.route?.effort).toBe('low')
    // A start on a runtime with no levels records no effort -- and must not inherit the old one.
    await store.rememberRoute(wren.teammateId, { runtime: 'cursor', model: 'composer-2.5', mode: 'auto' })
    expect((await store.list())[0]?.route).toEqual({ runtime: 'cursor', model: 'composer-2.5', mode: 'auto' })
  })
})
