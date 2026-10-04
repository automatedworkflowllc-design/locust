import { describe, expect, it } from 'vitest'

import { TIDY_EXAMPLE_LINES, TIDY_PROMPT, parseTidyBlocks } from './memory-tidy.js'
import { stripMemoryBlocks } from './memory.js'

/**
 * A FENCED TIDY BLOCK STILL COUNTS (0.372).
 *
 * The 62-memory tidy drive, second run: Wren read the file, found all ten
 * planted problems, and wrote them in a block -- inside a code fence, the way
 * the brief showed its example. The parser took a fenced block for an
 * example, so the pass proposed nothing, and the person read "Here are my
 * suggestions:" over an empty box. This is that reply, as OpenCode stored it.
 */
const FENCE = String.fromCharCode(96).repeat(3)
const WREN = [
  'Looking at the memory file, I found several duplicate pairs and superseded entries. Here are my suggestions:',
  '',
  FENCE,
  '<locust-tidy>',
  'merge mem_deploy_a mem_deploy_b :: We deploy every Thursday afternoon.',
  'merge mem_pnpm_a mem_pnpm_b :: The package manager for this repo is pnpm.',
  'retire mem_port_old :: Superseded by mem_port_new, API moved to port 3001 on September 20.',
  'retire mem_todo :: Deadline (Friday August 29) has passed; no longer actionable.',
  '</locust-tidy>',
  FENCE
].join('\n')

describe('a tidy block in a code fence', () => {
  it('is read like any other', () => {
    expect(parseTidyBlocks(WREN)).toEqual([
      { kind: 'merge', ids: ['mem_deploy_a', 'mem_deploy_b'], text: 'We deploy every Thursday afternoon.' },
      { kind: 'merge', ids: ['mem_pnpm_a', 'mem_pnpm_b'], text: 'The package manager for this repo is pnpm.' },
      { kind: 'retire', id: 'mem_port_old', reason: 'Superseded by mem_port_new, API moved to port 3001 on September 20.' },
      { kind: 'retire', id: 'mem_todo', reason: 'Deadline (Friday August 29) has passed; no longer actionable.' }
    ])
  })

  it('is asked once when it is shown and then written again', () => {
    const twice = `${WREN}\n\nOr, plainly:\n<locust-tidy>\nretire mem_todo :: Deadline has passed.\n</locust-tidy>`
    expect(parseTidyBlocks(twice).filter((suggestion) => suggestion.kind === 'retire' && suggestion.id === 'mem_todo')).toHaveLength(1)
  })

  it('leaves no empty box behind in the reply a person reads', () => {
    expect(stripMemoryBlocks(WREN)).toBe('Looking at the memory file, I found several duplicate pairs and superseded entries. Here are my suggestions:')
  })
})

describe('what the fence still protects against', () => {
  it('is the brief’s own example, which proposes nothing wherever it appears', () => {
    expect(parseTidyBlocks(TIDY_PROMPT)).toEqual([])
    expect(parseTidyBlocks(['<locust-tidy>', ...TIDY_EXAMPLE_LINES, '</locust-tidy>'].join('\n'))).toEqual([])
  })

  it('is no longer shown to the model in a fence', () => {
    expect(TIDY_PROMPT).not.toContain(FENCE)
    // And says where it goes: on the 0.372 drive a model wrote it into a shell command, cat << 'EOF'.
    expect(TIDY_PROMPT).toContain('Write the block in your reply itself -- not in a code block, a command or a file.')
    expect(TIDY_PROMPT).toContain(['<locust-tidy>', ...TIDY_EXAMPLE_LINES, '</locust-tidy>'].join('\n'))
  })
})

describe('a memory block in a code fence', () => {
  it('was not acted on, so it stays in the reply for the person to read', () => {
    const shown = `An example:\n${FENCE}\n<locust-memory>\nremember :: Deploys go out on Thursdays.\n</locust-memory>\n${FENCE}`
    expect(stripMemoryBlocks(shown)).toBe(shown)
    // Outside code it was acted on, and comes out.
    expect(stripMemoryBlocks('Noted.\n<locust-memory>\nremember :: Deploys go out on Thursdays.\n</locust-memory>')).toBe('Noted.')
  })
})
