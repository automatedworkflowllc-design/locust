import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every panel that opens from the composer closes when you press elsewhere.
 *
 * Reported by the first outside tester on 0.55.0: "for selecting the effort
 * level and model, you to click out of it you have to click the button again
 * instead of just clicking anywhere on the page."
 *
 * Three panels hang off the composer -- the permission mode menu, the effort
 * panel and the route picker -- and none of them closed on an outside press.
 * `ContextMenu` and `RailFlyout` in the same app always have, so it was not
 * a decision, it was three panels each written without the handler.
 *
 * Measured before and after with `_tools/probe-menus-dismiss.mjs`, on the
 * built app: every panel answered "closed on a click elsewhere: false"
 * before, and "true" after.
 *
 * This is a source check, and says so. What it actually guards is that a
 * FOURTH panel cannot be added to the composer without the handler -- the
 * way these three were. The behaviour itself is driven, not asserted here.
 */

const COMPOSER = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Composer.tsx', import.meta.url)),
  'utf8'
)

/** Source with comments removed: prose naming a panel is not a panel. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ')
}

const code = codeOnly(COMPOSER)

describe('the composer’s pop-open panels', () => {
  it('is reading the composer, and finds the panels it is about', () => {
    // The control. A renamed file or a changed convention would otherwise
    // let every assertion below pass over nothing.
    expect(code.length).toBeGreaterThan(5_000)
    expect(code).toContain('useDismissOnOutsidePress')
  })

  it('each closes on an outside press', () => {
    /*
     * Found by naming, so a panel added later is caught by the same rule
     * rather than needing to be listed here. Anything the composer holds
     * open with its own `somethingOpen` flag is a panel in this sense.
     */
    const flags = [...code.matchAll(/const \[(\w+Open), set\w+\] = useState\(false\)/g)].map((match) => match[1] ?? '')
    expect(flags.length).toBeGreaterThanOrEqual(3)
    for (const flag of flags) {
      expect(
        code,
        `${flag} opens a panel that nothing closes when you press elsewhere -- the exact thing reported on 0.55.0`
      ).toMatch(new RegExp(`useDismissOnOutsidePress\\(${flag},`))
    }
  })

  it('leaves the control that opens a panel able to close it', () => {
    // The close listens in the capture phase, so without an exception for
    // the control itself the button would close and instantly reopen. The
    // anchor holds both, and it is what is handed to the hook.
    const anchored = [...code.matchAll(/useDismissOnOutsidePress\(\w+, \w+, (\w+)\)/g)].map((match) => match[1] ?? '')
    expect(anchored.length).toBeGreaterThanOrEqual(3)
    for (const ref of anchored) {
      expect(code, `${ref} is handed to the hook but never put on an element`).toMatch(
        new RegExp(`ref=\\{${ref}\\}`)
      )
    }
  })
})
