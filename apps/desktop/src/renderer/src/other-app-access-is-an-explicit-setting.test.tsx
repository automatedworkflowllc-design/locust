import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocustMcpSettings } from './components/LocustMcpSettings.js'
import type { LocustMcpApi, LocustMcpState } from '../../shared/locust-mcp.js'
import { turnPromptLine } from './missionView.js'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, mounted: false, cleanups: [] as (() => void)[] }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.index++
    if (at >= hooks.values.length) hooks.values[at] = initial
    return [hooks.values[at], (value: unknown) => { hooks.values[at] = value }]
  },
  useEffect: (effect: () => (() => void) | undefined) => { if (!hooks.mounted) { hooks.mounted = true; const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup) } }
}))
beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.mounted = false })
afterEach(() => { for (const cleanup of hooks.cleanups.splice(0)) cleanup(); vi.clearAllMocks() })
const surface = (api: LocustMcpApi) => { hooks.index = 0; return LocustMcpSettings({ api, heading: <h2>Let your other AI apps use Locust</h2> }) }
const button = (element: ReactElement): { onClick(): void; disabled: boolean } => {
  const children = element.props as { children: ReactElement[] }
  const line = children.children[0]!.props as { children: ReactElement[] }
  return line.children[1]!.props as { onClick(): void; disabled: boolean }
}
const enabled: LocustMcpState = { enabled: true, claudeCommand: 'claude mcp add example', codexConfig: '[mcp_servers.locust]\ncommand = "example"' }
describe('other-app access is an explicit setting', () => {
  it('loads the actual setting, makes no enable request on mount, and shows no setup while off', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false })), setEnabled: vi.fn(async () => enabled) }
    expect(button(surface(api)).disabled).toBe(true)
    await Promise.resolve()
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('Off. No local server is listening.')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toContain('mcp_servers')
    expect(api.setEnabled).not.toHaveBeenCalled()
  })
  it('enables only after a press, then shows the exact host-owned command/config and tradeoff', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false })), setEnabled: vi.fn(async () => enabled) }
    surface(api); await Promise.resolve()
    button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual(enabled))
    expect(api.setEnabled).toHaveBeenCalledWith(true)
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('claude mcp add example')
    expect(html).toContain('[mcp_servers.locust]')
    expect(html).toContain('New turns are Ask mode (read only)')
    expect(html).toContain('with no automatic teammate handoffs')
    expect(html).toContain('Locust must be running')
    expect(html).toContain('monthly limits still apply')
    expect(html).toContain('Locust never writes another app&#x27;s configuration')
  })
  it('turns the server off and removes the setup text when the host confirms it', async () => {
    const api = { settings: vi.fn(async () => enabled), setEnabled: vi.fn(async () => ({ enabled: false })) }
    surface(api); await Promise.resolve()
    button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ enabled: false }))
    expect(api.setEnabled).toHaveBeenCalledWith(false)
    expect(renderToStaticMarkup(surface(api))).not.toContain('[mcp_servers.locust]')
  })
  it('keeps the actual off state and says why if the listener could not be enabled', async () => {
    const api = { settings: vi.fn(async () => ({ enabled: false })), setEnabled: vi.fn(async () => ({ enabled: false, message: 'The server is still off.' })) }
    surface(api); await Promise.resolve(); button(surface(api)).onClick()
    await vi.waitFor(() => expect(hooks.values[0]).toEqual({ enabled: false, message: 'The server is still off.' }))
    const html = renderToStaticMarkup(surface(api))
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('The server is still off.')
  })
  it('keeps an externally sent message visible without turning it into relay instructions', () => {
    expect(turnPromptLine({ prompt: 'Review this.', startedBy: { kind: 'mcp' } })).toBe('Review this.')
  })
})
