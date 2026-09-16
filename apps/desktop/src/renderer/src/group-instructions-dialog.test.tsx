import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicGroup } from '../../shared/ipc.js'
import { GroupInstructionsDialog, MAX_GROUP_INSTRUCTIONS } from './components/GroupInstructionsDialog.js'

/**
 * The dialog says exactly what is true about when instructions apply: turns
 * started from now on, in this group's conversations. Nothing about turns
 * already run, which were not briefed.
 */

const trading: PublicGroup = { groupId: 'g1', name: 'Trading', createdAt: '2026-09-16T00:00:00.000Z', instructions: '' }
const noop = (): void => undefined

describe('the standing-instructions dialog', () => {
  it('names the group, says when the words apply, and holds the store\'s own cap', () => {
    const html = renderToStaticMarkup(<GroupInstructionsDialog group={trading} onSave={noop} onCancel={noop} />)
    expect(html).toContain('Standing instructions')
    expect(html).toContain('Trading')
    expect(html).toContain('every turn started from now on')
    expect(html).toContain('Turns already run were not briefed')
    expect(html).toContain(`maxLength="${String(MAX_GROUP_INSTRUCTIONS)}"`)
    expect(MAX_GROUP_INSTRUCTIONS).toBe(4000)
  })

  it('offers to clear when the group had words and the box is empty', () => {
    const held = { ...trading, instructions: 'Quote sizes in shares.' }
    // Rendered statically the box holds the group's words, so Save is the
    // label; the Clear label is the empty-box state, reached by typing.
    const html = renderToStaticMarkup(<GroupInstructionsDialog group={held} onSave={noop} onCancel={noop} />)
    expect(html).toContain('Quote sizes in shares.')
    expect(html).toContain('>Save<')
  })
})
