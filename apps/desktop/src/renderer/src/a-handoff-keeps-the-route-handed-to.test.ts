import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'

/**
 * M29 (the code review): after a handoff the chat box went back to the route
 * handed AWAY from. The chat box draws `composerRouteFor(route, teammate,
 * pickerRoutes)`, which prefers the teammate's own pick, and the handoff set
 * only the bare route -- so the chip, and the next follow-up, returned to the
 * runtime the person had just left. Driven by drive-handoff-keeps-route.
 */
describe('a handoff and the route the chat box shows', () => {
  it('sets the teammate’s own pick to the route handed to', () => {
    const start = APP.indexOf('const handOffMission = async')
    const end = APP.indexOf('const cancelMission', start)
    const body = APP.slice(start, end)
    expect(start).toBeGreaterThan(0)
    expect(body).toContain('setPickerRoutes((routes) => new Map(routes).set(ownerId, choice))')
  })
})
