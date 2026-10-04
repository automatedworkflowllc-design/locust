import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { baseModelId, createCursorDefaultModel, namedModel } from './cursor-default-model.js'

/**
 * A CURSOR RUN LEAVES THE PERSON'S OWN CURSOR AS IT FOUND IT (0.431).
 *
 * `cursor-agent --model X` saves X as the person's Cursor default (measured
 * 2026-09-27 and 2026-09-28). Colin agreed Locust should put it back.
 */
const GROK = {
  model: { modelId: 'grok-4.7', displayName: 'Grok 4.7 256K Medium', maxMode: false },
  selectedModel: { modelId: 'grok-4.7', parameters: [{ id: 'context', value: '256k' }, { id: 'reasoning_effort', value: 'medium' }] },
  modelSelectionHistory: ['grok-4.7', 'claude-opus-5']
}
const COMPOSER = {
  model: { modelId: 'composer-2.5', displayName: 'Composer 2.5', maxMode: false },
  selectedModel: { modelId: 'composer-2.5', parameters: [{ id: 'fast', value: 'false' }] },
  modelSelectionHistory: ['composer-2.5', 'grok-4.7', 'claude-opus-5']
}
/** Stands in for the sign-in the real file holds: it must come back exactly, and never be kept elsewhere. */
const SIGN_IN = { authInfo: { accessToken: 'not-a-real-token-7f3a', email: 'person@example.com' }, permissions: { allow: ['Shell(ls)'] } }

describe("the person's Cursor default, around a Cursor run", () => {
  let folder: string
  let file: string
  let keptFile: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-cursor-default-'))
    file = join(folder, 'cli-config.json')
    keptFile = join(folder, 'cursor-default-model.json')
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })
  const write = (config: Record<string, unknown>): Promise<void> => writeFile(file, JSON.stringify(config, null, 2), 'utf8')
  const config = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>

  it('is put back when the run ends, and everything else in the file comes back exactly, the sign-in included', async () => {
    await write({ ...SIGN_IN, ...GROK, version: 1 })
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5')
    // What Cursor itself does with --model.
    await write({ ...SIGN_IN, ...COMPOSER, version: 1 })
    await guard.after()
    expect(await config()).toEqual({ ...SIGN_IN, ...GROK, version: 1 })
    // Written as Cursor writes it: two spaces, no final newline.
    expect((await readFile(file, 'utf8')).startsWith('{\n  "authInfo"')).toBe(true)
    // And nothing kept about it once done.
    await expect(readFile(keptFile, 'utf8')).rejects.toThrow()
  })

  it('never keeps the sign-in anywhere of its own, even mid-run', async () => {
    await write({ ...SIGN_IN, ...GROK })
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5')
    const kept = await readFile(keptFile, 'utf8')
    expect(kept).not.toContain('not-a-real-token')
    expect(kept).not.toContain('person@example.com')
    expect(kept).toContain('grok-4.7')
  })

  it('leaves it alone when the person chose another model themselves during the run', async () => {
    await write({ ...SIGN_IN, ...GROK })
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5')
    const THEIRS = { model: { modelId: 'gpt-6-sol' }, selectedModel: { modelId: 'gpt-6-sol' }, modelSelectionHistory: ['gpt-6-sol'] }
    await write({ ...SIGN_IN, ...THEIRS })
    await guard.after()
    expect(await config()).toEqual({ ...SIGN_IN, ...THEIRS })
  })

  it('with runs overlapping, puts back the state before the first when the last ends', async () => {
    await write({ ...SIGN_IN, ...GROK })
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5')
    await write({ ...SIGN_IN, ...COMPOSER })
    await guard.before('composer-2.5[fast=true]')
    await guard.after()
    expect((await config()).model).toEqual(COMPOSER.model)
    await guard.after()
    expect(await config()).toEqual({ ...SIGN_IN, ...GROK })
  })

  it('is put back on the next start when Locust quit mid-run', async () => {
    await write({ ...SIGN_IN, ...GROK })
    await createCursorDefaultModel({ file, keptFile }).before('composer-2.5')
    await write({ ...SIGN_IN, ...COMPOSER })
    await createCursorDefaultModel({ file, keptFile }).recover()
    expect(await config()).toEqual({ ...SIGN_IN, ...GROK })
    await expect(readFile(keptFile, 'utf8')).rejects.toThrow()
  })

  it('does nothing when there is no Cursor config, or the run changed nothing', async () => {
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5')
    await guard.after()
    await expect(readFile(file, 'utf8')).rejects.toThrow()
    await write({ ...SIGN_IN, ...GROK })
    const text = await readFile(file, 'utf8')
    await guard.before('grok-4.7')
    await guard.after()
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  it('is put back when the run named a list id Cursor saves as its base id: composer-2.5-fast is composer-2.5 (measured)', async () => {
    await write({ ...SIGN_IN, ...GROK })
    const guard = createCursorDefaultModel({ file, keptFile })
    await guard.before('composer-2.5-fast')
    await write({ ...SIGN_IN, ...COMPOSER, selectedModel: { modelId: 'composer-2.5', parameters: [{ id: 'fast', value: 'true' }] } })
    await guard.after()
    expect(await config()).toEqual({ ...SIGN_IN, ...GROK })
  })

  it('matches a model to the id it is saved under, and nothing else', () => {
    expect(namedModel('composer-2.5-fast', 'composer-2.5')).toBe(true)
    expect(namedModel('grok-4.7-256k-medium', 'grok-4.7')).toBe(true)
    expect(namedModel('composer-2.5[fast=true]', 'composer-2.5')).toBe(true)
    expect(namedModel('composer-2.5', 'composer-2.5')).toBe(true)
    expect(namedModel('composer-2.5', 'gpt-6-sol')).toBe(false)
    expect(namedModel('grok-4.7', 'grok-4.6')).toBe(false)
    expect(namedModel('gpt-6', 'gpt-6-sol')).toBe(true)
    expect(namedModel('composer-2.5', undefined)).toBe(false)
  })

  it('reads a model with bracketed options as its plain id', () => {
    expect(baseModelId('composer-2.5[fast=true]')).toBe('composer-2.5')
    expect(baseModelId('grok-4.7')).toBe('grok-4.7')
  })
})
