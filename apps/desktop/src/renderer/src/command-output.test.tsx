import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActivityCard } from './components/ActivityCard.js'
import type { ActivityDetail } from './missionView.js'

/**
 * The command row, rendered — the four cases the design pass drew.
 *
 * This exists because the drive that would show these spends Codex quota:
 * only the Codex exec stream reports command output, so the one runtime that
 * can produce this surface is the one reserved for another teammate. The
 * design agent asked for eyes on two cases in particular — a failing run's
 * tail, and a command that printed nothing — and this is what can be checked
 * without spending anything.
 *
 * What it cannot check, stated rather than implied: the output BODY. The fold
 * opens by default only onto a file row (`defaultOpenEntry` returns a `file`
 * entry or nothing), and server rendering cannot press the row open, so the
 * 8+8 split, the elision control and the copy button are covered by
 * `boundedShellOutput`'s own tests and not by any rendering. What IS checked
 * here is everything visible with the fold open and the rows closed, which is
 * where all four of the drawn cases differ from each other.
 */

const shell = (over: Partial<ActivityDetail> & { readonly name: string }): ActivityDetail =>
  ({ kind: 'shell', tool: 'shell', settled: true, ...over }) as ActivityDetail

/** Fold chevrons in the markup. The card has one; an openable row adds another. */
const chevrons = (html: string): number => (html.match(/lc-activity__chev/g) ?? []).length

const render = (details: readonly ActivityDetail[]): string =>
  renderToStaticMarkup(
    <ActivityCard
      summary="ran 1 command"
      details={details}
      runtimeName="Codex CLI"
      workspacePath="C:/work"
      openByDefault
    />
  )

describe('the four command cases the design drew', () => {
  it('a clean run leads with a green exit badge, before the command', () => {
    /*
     * THE positional claim. The exit code used to sit at the far right of the
     * row, which is where the eye arrives last for the fact that decides
     * whether the output below is worth reading at all.
     *
     * Asserted by INDEX in the markup rather than by presence, because "the
     * badge exists" was true before the change too.
     */
    const html = render([shell({ name: 'seq 1 300', output: '1\n2\n3', exitCode: 0 })])
    const badge = html.indexOf('lc-shellbadge')
    const command = html.indexOf('seq 1 300')
    expect(badge).toBeGreaterThan(-1)
    expect(badge).toBeLessThan(command)
    expect(html).toContain('is-ok')
    expect(html).toContain('exit 0')
  })

  it('a failing run is red at the head', () => {
    const html = render([
      shell({ name: 'pnpm test billing', output: 'FAIL src/billing.test.ts', exitCode: 1, failed: true })
    ])
    expect(html).toContain('lc-shellbadge')
    expect(html).toContain('is-failed')
    expect(html).toMatch(/exit 1|failed/)
  })

  it('a command that printed nothing says so, and does not offer to open', () => {
    /*
     * One of the two cases the shipped block had no answer for. An empty
     * string is the runtime REPORTING no output; it used to open onto an empty
     * black rectangle, which reads as "the app lost it" rather than "there was
     * none".
     */
    const html = render([shell({ name: 'chmod +x run.sh', output: '', exitCode: 0 })])
    expect(html).toContain('no output')
    // Static, not a button: there is nothing behind it to open.
    expect(html).toContain('is-static')
    /*
     * COUNTED, not merely absent. The first version asserted
     * `not.toContain('lc-activity__chev')` and failed on a correct render:
     * the CARD's own fold has a chevron too, so the string was always
     * present and the assertion was reading the wrong element. The card
     * contributes exactly one; a row that can open contributes another.
     */
    expect(chevrons(html)).toBe(1)
  })

  it('a command whose output the runtime never reported is NOT called empty', () => {
    /*
     * The control that keeps the case above honest. `undefined` (the runtime
     * said nothing about output) and `''` (it said there was none) are
     * different facts. Claiming "no output" for the first would be inventing a
     * result on the runtimes that do not report one at all -- which is five of
     * the six.
     */
    const html = render([shell({ name: 'git status', exitCode: 0 })])
    expect(html).not.toContain('no output')
    expect(html).toContain('is-static')
    expect(chevrons(html)).toBe(1)
  })

  it('a command WITH output offers to open', () => {
    // The other side of the control: the chevron must appear exactly where
    // there is something behind it.
    const html = render([shell({ name: 'ls -la', output: 'a\nb', exitCode: 0 })])
    expect(chevrons(html)).toBe(2)
  })
})
