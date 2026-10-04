import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'
import { composerRouteFor } from '../../shared/route-at-start.js'

/**
 * M29 (the code review): after a handoff the chat box went back to the route
 * handed AWAY from. Since 0.552 the box reads the conversation's own route --
 * the handed-to run's record -- before the teammate's saved model, so the
 * chip follows the handoff without the handoff rewriting the teammate.
 * Driven by drive-handoff-keeps-route.
 */
describe('a handoff and the route the chat box shows', () => {
  it('shows the route handed to, over the teammate\'s saved model', () => {
    const teammate = { teammateId: 'tm_wren', route: { runtime: 'codex' as const, model: 'gpt-6-luna', mode: 'ask' as const } }
    const handedTo = { runtime: 'claude' as const, model: 'claude-sonnet-5' }
    expect(composerRouteFor({ runtime: 'codex', model: 'gpt-6-luna' }, teammate, new Map(), 'mission_handed', handedTo)).toEqual(handedTo)
  })
  it('does not make the handed-to route the teammate\'s own', () => {
    const start = APP.indexOf('const handOffMission = async')
    const end = APP.indexOf('const cancelMission', start)
    const body = APP.slice(start, end)
    expect(start).toBeGreaterThan(0)
    expect(body).not.toContain('setPickerRoutes((routes) => new Map(routes).set(ownerId')
    expect(body).toContain('teammate.teammateId === ownerId && teammate.route === undefined')
  })
})
