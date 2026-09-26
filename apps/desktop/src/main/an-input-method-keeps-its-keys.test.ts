import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Code review B4, renderer-thread (a): the composer had no composition
 * guard, so Enter confirming an IME word sent the half-typed message and
 * Escape cancelling one stopped the run. The guard is the handler's first
 * statement, before the slash menu, Shift+Tab, Escape or Enter can act.
 */
const COMPOSER = readFileSync(fileURLToPath(new URL('../renderer/src/components/Composer.tsx', import.meta.url)), 'utf8')

describe('an input method keeps its keys', () => {
  it('is checked before any key the composer acts on', () => {
    const handler = COMPOSER.indexOf('const keyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {')
    expect(handler).toBeGreaterThan(0)
    const guard = COMPOSER.indexOf('if (keyEvent.nativeEvent.isComposing || keyEvent.keyCode === 229) return', handler)
    const firstKey = COMPOSER.indexOf("keyEvent.key ===", handler)
    expect(guard).toBeGreaterThan(handler)
    expect(guard).toBeLessThan(firstKey)
  }, 10_000)
})
