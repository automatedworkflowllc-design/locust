import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicGroup, TeammateRoute } from '../../shared/ipc.js'
import { COUNTER_FROM, GroupSettingsDialog, MAX_GROUP_INSTRUCTIONS, routeLabel } from './components/GroupSettingsDialog.js'

/**
 * One dialog for both of a group's properties, worded as the design agent
 * ruled on 2026-09-16: the claim above the box, the provenance below it in
 * mono, the route in the composer's own display names, and a Clear that is
 * disabled rather than absent when there is nothing to clear.
 */

const trading: PublicGroup = { groupId: 'g1', name: 'Trading', createdAt: '2026-09-16T00:00:00.000Z', instructions: '' }
const current: TeammateRoute = { runtime: 'codex', model: 'account-default', mode: 'auto' }
const noop = (): void => undefined
const html = (group: PublicGroup): string =>
  renderToStaticMarkup(<GroupSettingsDialog group={group} currentRoute={current} onSave={noop} onCancel={noop} />)

describe('the group settings dialog', () => {
  it('is titled for the group, not for one of its two properties', () => {
    const page = html(trading)
    expect(page).toContain('Project settings')
    expect(page).toContain('Trading')
    expect(page).toContain('Standing instructions')
    expect(page).toContain('Default route')
  })

  it('says the one claim above the box and the provenance below it', () => {
    const page = html(trading)
    expect(page).toContain('Briefs every turn started from now on. Turns already run were not briefed.')
    expect(page).toContain("Given after the folder&#x27;s own LOCUST.md.")
    expect(page).not.toContain('Clear it and')
  })

  it('shows the counter only once it is worth reading', () => {
    expect(html(trading)).not.toContain(`/ ${String(MAX_GROUP_INSTRUCTIONS)}`)
    const long = { ...trading, instructions: 'x'.repeat(COUNTER_FROM + 1) }
    expect(html(long)).toContain(`${String(COUNTER_FROM + 1)} / ${String(MAX_GROUP_INSTRUCTIONS)}`)
  })

  it('names the route the way the composer does, and says what Use current would take', () => {
    const routed = { ...trading, route: { runtime: 'opencode' as const, model: 'opencode/muse-spark-1.3-contributor-free', mode: 'ask' as const } }
    const page = html(routed)
    expect(page).toContain(routeLabel(routed.route))
    expect(page).not.toContain('opencode/muse-spark-1.3-contributor-free')
    expect(page).toContain(`Composer now shows ${routeLabel(current)}.`)
    const none = html(trading)
    expect(none).toContain('None — each conversation keeps what it has')
    expect(none).toContain(`Use current takes ${routeLabel(current)} from the composer.`)
  })

  it('disables Clear when there is no route, rather than hiding it', () => {
    const none = html(trading)
    expect(none).toMatch(/lc-groupsettings__clear"[^>]*disabled/)
    const routed = { ...trading, route: current }
    expect(html(routed)).not.toMatch(/lc-groupsettings__clear"[^>]*disabled/)
  })
})
