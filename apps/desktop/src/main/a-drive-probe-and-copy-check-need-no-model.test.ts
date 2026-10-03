// Requested polish: "route: no route control" off stderr and "a deterministic Copy-on-hover drive" (executor plan, 2026-10-03).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the drive polish', () => {
  it('replaces the judge native arrow with a chevron that cannot intercept selection', () => {
    const css = readFileSync(new URL('../renderer/src/shell.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.lc-compare__select select\s*\{[^}]*appearance: none/)
    expect(css).toMatch(/\.lc-compare__select > svg\s*\{[^}]*pointer-events: none/)
  })
  it('prints the missing-control probe to stdout', () => {
    const module = new URL('../../../../_tools/drive-lib.mjs', import.meta.url).href
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', `import { reportRouteProbe } from ${JSON.stringify(module)}; reportRouteProbe(''); reportRouteProbe('OpenCode');`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    expect(stdout).toBe('route: no route control on this screen\nroute: OpenCode\n')
    const source = readFileSync(new URL('../../../../_tools/drive-lib.mjs', import.meta.url), 'utf8')
    expect(source).toContain('      reportRouteProbe(route)')
  })

  it('opens a seeded conversation before asserting Copy and offers a mode that sends nothing', () => {
    const source = readFileSync(new URL('../../../../_tools/drive-a-turn-round-trip.mjs', import.meta.url), 'utf8')
    expect(source).toContain('const fixture = await seedCopyHoverConversation(workspace)')
    expect(source).toContain('profilePath: fixture.profilePath,')
    expect(source).toContain('...(copyOnly ? { sendsNothing: true } : {})')
    expect(source).toContain('if (!copyOnly) {')
    expect(source.indexOf('Copy hover fixture is missing')).toBeLessThan(source.indexOf('const copies ='))
    expect(source).toContain("type: 'mouseMoved', x: 5, y: 5")
  })
})
