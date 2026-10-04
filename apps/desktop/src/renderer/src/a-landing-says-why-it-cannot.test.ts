import { describe, expect, it } from 'vitest'

import type { PublicLandBlock } from '../../shared/ipc.js'
import { landBlockSentence } from './components/ReviewChanges.js'

/**
 * LAND IT SAYS WHY IT CANNOT, IN PLACE OF THE BUTTON (0.440).
 *
 * Colin's bar for idea #2 (2026-09-28): "if we cant make it clean and
 * seamless, we dont do it". A landing that fails on the press is the
 * clunky kind, so every refusal is read before the button is offered and
 * said where the button would be -- naming the files and what would change
 * it, never "could not land".
 */
const every: readonly PublicLandBlock[] = [
  { kind: 'nothing' },
  { kind: 'busy' },
  { kind: 'detached' },
  { kind: 'merging' },
  { kind: 'old-git', version: '2.30.1' },
  { kind: 'unsaved', files: ['scratch.txt'] },
  { kind: 'markers', files: ['cart.py'] },
  { kind: 'your-changes', files: ['cart.py', 'README.md', 'a.py', 'b.py'] },
  { kind: 'conflicts', files: ['cart.py'] }
]

describe('why a branch cannot land', () => {
  it('is a sentence for every reason, naming the teammate or the files', () => {
    for (const block of every) {
      const said = landBlockSentence(block, 'Wren', 'main')
      expect(said.length).toBeGreaterThan(20)
      expect(said.endsWith('.')).toBe(true)
      if ('files' in block) expect(said).toContain(block.files[0]!)
    }
  })

  it('says what would change it, where the person can act', () => {
    expect(landBlockSentence({ kind: 'your-changes', files: ['cart.py'] }, 'Wren', 'main')).toBe('You have unsaved changes in cart.py, which this landing would overwrite. Commit them or set them aside, then read it again.')
    expect(landBlockSentence({ kind: 'busy' }, 'Wren', 'main')).toBe('Wren is working. Land it when the turn ends.')
    expect(landBlockSentence({ kind: 'conflicts', files: ['cart.py'] }, 'Wren', 'main')).toBe('cart.py was changed on main too, in the same places.')
    expect(landBlockSentence({ kind: 'old-git', version: '2.30.1' }, 'Wren', 'main')).toContain('this machine has 2.30.1')
    expect(landBlockSentence({ kind: 'your-changes', files: ['a', 'b', 'c', 'd'] }, 'Wren', 'main')).toContain('a, b and 2 more')
  })
})
