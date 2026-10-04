import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RemoveAllRules } from './components/SavedApprovalRules.js'

/**
 * EVERY SAVED RULE CAN GO AT ONCE (0.587): the control under the rules list.
 * One press asks; the second names how many go and that every card asks
 * again. Nothing is removed by the first press.
 */
const draw = (confirming: boolean, count = 3): string =>
  renderToStaticMarkup(<RemoveAllRules count={count} confirming={confirming} removing={false} onAsk={() => undefined} onConfirm={() => undefined} onKeep={() => undefined} />)

describe('the Remove all rules control', () => {
  it('offers to start over, and nothing more, until pressed', () => {
    const html = draw(false)
    expect(html).toContain('Remove all rules')
    expect(html).not.toContain('Every card asks again')
    expect(html).not.toContain('Keep them')
  })

  it('then says how many go and that every card asks again, with a way back', () => {
    const html = draw(true)
    expect(html).toContain('Remove all 3 saved rules? Every card asks again afterwards.')
    expect(html).toContain('>Remove all<')
    expect(html).toContain('Keep them')
    expect(draw(true, 1)).toContain('Remove the 1 saved rule?')
  })
})
