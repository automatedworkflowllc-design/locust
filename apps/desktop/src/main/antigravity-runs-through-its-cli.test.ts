import { describe, expect, it } from 'vitest'

import { whatItMayDo } from '../shared/may-do.js'
import { hostReadsEventsOf } from '../shared/runtimes.js'
import { agyRoute } from './codex-mission.js'

/**
 * ANTIGRAVITY RUNS THROUGH ITS CLI (0.540). Google moved personal accounts
 * from Gemini CLI to Antigravity CLI; `agy` runs headless with a stream the
 * host reads whole, so Antigravity is one more runtime the runner drives.
 */
describe('Antigravity through its CLI', () => {
  it('is a runtime whose events the host reads', () => {
    expect(hostReadsEventsOf('antigravity')).toBe(true)
    expect(hostReadsEventsOf('gemini')).toBe(false)
  })

  it('carries an app tier, or an id with its effort on the end, to a model and an effort; the effort chosen in the box wins', () => {
    expect(agyRoute('flash', undefined)).toEqual({ model: 'gemini-3.8-flash', effort: 'medium' })
    expect(agyRoute('pro', undefined)).toEqual({ model: 'gemini-3.1-pro', effort: 'high' })
    expect(agyRoute('flash_lite', undefined)).toEqual({ model: 'gemini-3.8-flash', effort: 'low' })
    expect(agyRoute('gemini-3.8-flash-low', undefined)).toEqual({ model: 'gemini-3.8-flash', effort: 'low' })
    expect(agyRoute('gemini-3.8-flash-low', 'high')).toEqual({ model: 'gemini-3.8-flash', effort: 'high' })
    expect(agyRoute('claude-opus-4-6-thinking', undefined)).toEqual({ model: 'claude-opus-4-6-thinking' })
    expect(agyRoute(undefined, undefined)).toEqual({})
  })
})

describe('what an Antigravity run may do, as measured', () => {
  it('runs commands only in Auto', () => {
    const said = (sandbox: 'read-only' | 'workspace-write' | 'full-access') => JSON.stringify(whatItMayDo('antigravity', sandbox))
    expect(said('full-access')).toMatch(/command/i)
    expect(said('workspace-write')).not.toMatch(/any command/i)
  })
})
