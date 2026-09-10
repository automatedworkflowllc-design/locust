import { describe, expect, it } from 'vitest'
import { composerRouteFor, routeAtStart } from '../shared/route-at-start.js'
import type { TeammateRoute } from '../shared/ipc.js'

const saved: TeammateRoute = { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'accept-edits', effort: 'low' }
const wren = { teammateId: 'tm_wren', route: saved }
const fallback = { runtime: 'opencode', model: 'account-default' } as const

describe('route authority at the moment of start', () => {
  it('honours an explicit picker override for this teammate', () => {
    expect(routeAtStart({ ...fallback, routeOverrideFor: 'tm_wren' }, wren)).toEqual(fallback)
  })
  it('uses the host saved route over discovery/default selections, including saved effort', () => {
    expect(routeAtStart(fallback, wren)).toEqual({ runtime: 'codex', model: saved.model, effort: 'low' })
  })
  it('leaves nobody\'s mission on the composer route, regardless of old picker intent', () => {
    expect(routeAtStart({ ...fallback, effort: 'high', routeOverrideFor: 'tm_wren' }, undefined))
      .toEqual({ ...fallback, effort: 'high' })
  })
  it('does not mistake another teammate\'s picker change for this teammate\'s choice', () => {
    expect(routeAtStart({ ...fallback, routeOverrideFor: 'tm_gem' }, wren).runtime).toBe('codex')
  })
  it('preserves account-default as an intentional picker selection', () => {
    expect(routeAtStart({ runtime: 'codex', model: 'account-default', routeOverrideFor: 'tm_wren' }, wren))
      .toEqual({ runtime: 'codex', model: 'account-default' })
  })
  it('does not promote a seeded account-default to picker intent', () => {
    expect(routeAtStart({ runtime: 'codex', model: 'account-default' }, wren).model).toBe(saved.model)
  })
  it('keeps existing defaults for a new teammate without a saved route', () => {
    expect(routeAtStart(fallback, { teammateId: 'tm_new' })).toEqual(fallback)
    expect(routeAtStart({}, undefined)).toEqual({ runtime: 'codex' })
  })
  it('keeps effort changes when the request is based on the saved picker identity', () => {
    expect(routeAtStart({ runtime: 'codex', model: saved.model, effort: 'high' }, wren))
      .toEqual({ runtime: 'codex', model: saved.model, effort: 'high' })
  })
  it('preserves concrete effort variants without declaring them a new picker choice', () => {
    const cursor = { teammateId: 'tm_wren', route: { ...saved, runtime: 'cursor' as const, model: 'grok-low' } }
    expect(routeAtStart({ runtime: 'cursor', modelChoice: 'grok-low', model: 'grok-high' }, cursor))
      .toEqual({ runtime: 'cursor', model: 'grok-high' })
  })
  it('cannot carry a stale effort or model transform across a different saved route', () => {
    expect(routeAtStart({ runtime: 'cursor', modelChoice: 'grok-low', model: 'grok-high', effort: 'high' }, wren))
      .toEqual({ runtime: 'codex', model: saved.model, effort: 'low' })
  })
  it('returns no permission mode for the caller to accidentally inherit', () => {
    expect(routeAtStart(fallback, wren)).not.toHaveProperty('mode')
  })
})

describe('picker intent belongs to a teammate, not the last route effect', () => {
  const choices = new Map([['tm_gem', fallback]])
  it('a different teammate gets their own saved chip', () => {
    expect(composerRouteFor(fallback, wren, choices)).toEqual(saved)
  })
  it('returning to the teammate retains their explicit choice for this session', () => {
    expect(composerRouteFor({ runtime: 'codex', model: saved.model }, { ...wren, teammateId: 'tm_gem' }, choices)).toEqual(fallback)
  })
  it('home does not inherit a teammate override', () => {
    const home = { runtime: 'claude' as const, model: 'account-default' }
    expect(composerRouteFor(home, undefined, choices)).toBe(home)
  })
})
